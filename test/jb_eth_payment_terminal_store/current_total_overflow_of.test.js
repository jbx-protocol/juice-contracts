import { expect } from 'chai';
import { ethers } from 'hardhat';

import { deployMockContract } from '@ethereum-waffle/mock-contract';

import { packFundingCycleMetadata } from '../helpers/utils';

import jbController from '../../artifacts/contracts/interfaces/IJBController.sol/IJBController.json';
import jbDirectory from '../../artifacts/contracts/interfaces/IJBDirectory.sol/IJBDirectory.json';
import jBFundingCycleStore from '../../artifacts/contracts/interfaces/IJBFundingCycleStore.sol/IJBFundingCycleStore.json';
import jbPrices from '../../artifacts/contracts/interfaces/IJBPrices.sol/IJBPrices.json';
import jbProjects from '../../artifacts/contracts/interfaces/IJBProjects.sol/IJBProjects.json';
import jbTerminal from '../../artifacts/contracts/interfaces/IJBTerminal.sol/IJBTerminal.json';
import jbTokenStore from '../../artifacts/contracts/interfaces/IJBTokenStore.sol/IJBTokenStore.json';

describe('JBETHPaymentTerminalStore::currentTotalOverflowOf(...)', function () {
  const PROJECT_ID = 2;
  const AMOUNT = ethers.FixedNumber.fromString('4398541.345');
  const WEIGHT = ethers.FixedNumber.fromString('900000000.23411');

  async function setup() {
    const [deployer] = await ethers.getSigners();

    const mockJbPrices = await deployMockContract(deployer, jbPrices.abi);
    const mockJbProjects = await deployMockContract(deployer, jbProjects.abi);
    const mockJbDirectory = await deployMockContract(deployer, jbDirectory.abi);
    const mockJbFundingCycleStore = await deployMockContract(deployer, jBFundingCycleStore.abi);
    const mockJbTokenStore = await deployMockContract(deployer, jbTokenStore.abi);
    const mockJbController = await deployMockContract(deployer, jbController.abi);
    const mockJbTerminalA = await deployMockContract(deployer, jbTerminal.abi);
    const mockJbTerminalB = await deployMockContract(deployer, jbTerminal.abi);

    const jbCurrenciesFactory = await ethers.getContractFactory('JBCurrencies');
    const jbCurrencies = await jbCurrenciesFactory.deploy();
    const CURRENCY_ETH = await jbCurrencies.ETH();
    const CURRENCY_USD = await jbCurrencies.USD();

    const jbEthPaymentTerminalStoreFactory = await ethers.getContractFactory(
      'JBETHPaymentTerminalStore',
    );
    const jbEthPaymentTerminalStore = await jbEthPaymentTerminalStoreFactory.deploy(
      mockJbPrices.address,
      mockJbProjects.address,
      mockJbDirectory.address,
      mockJbFundingCycleStore.address,
      mockJbTokenStore.address,
    );

    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    const timestamp = block.timestamp;

    // Set terminal address
    await jbEthPaymentTerminalStore.claimFor(mockJbTerminalA.address);

    return {
      mockJbTerminalA,
      mockJbTerminalB,
      mockJbController,
      mockJbDirectory,
      mockJbFundingCycleStore,
      mockJbPrices,
      jbEthPaymentTerminalStore,
      timestamp,
      CURRENCY_ETH,
      CURRENCY_USD,
    };
  }

  it('Should return total current overflow across multiple terminals', async function () {
    const {
      mockJbTerminalA,
      mockJbTerminalB,
      mockJbController,
      mockJbDirectory,
      mockJbFundingCycleStore,
      mockJbPrices,
      jbEthPaymentTerminalStore,
      timestamp,
      CURRENCY_ETH,
      CURRENCY_USD,
    } = await setup();

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      number: 1,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packFundingCycleMetadata(),
    });

    await mockJbDirectory.mock.terminalsOf
      .withArgs(PROJECT_ID)
      .returns([mockJbTerminalA.address, mockJbTerminalB.address]);

    const balance = AMOUNT.mulUnsafe(ethers.FixedNumber.from(2));
    await mockJbTerminalA.mock.ethBalanceOf.withArgs(PROJECT_ID).returns(balance);
    await mockJbTerminalB.mock.ethBalanceOf.withArgs(PROJECT_ID).returns(balance);

    await mockJbTerminalA.mock.remainingDistributionLimitOf
      .withArgs(PROJECT_ID, timestamp, 1)
      .returns(AMOUNT);
    await mockJbTerminalB.mock.remainingDistributionLimitOf
      .withArgs(PROJECT_ID, timestamp, 1)
      .returns(AMOUNT);

    await mockJbDirectory.mock.controllerOf.withArgs(PROJECT_ID).returns(mockJbController.address);

    await mockJbController.mock.distributionLimitCurrencyOf
      .withArgs(PROJECT_ID, timestamp, mockJbTerminalA.address)
      .returns(CURRENCY_ETH);
    await mockJbController.mock.distributionLimitCurrencyOf
      .withArgs(PROJECT_ID, timestamp, mockJbTerminalB.address)
      .returns(CURRENCY_USD);

    await mockJbPrices.mock.priceFor
      .withArgs(CURRENCY_USD, CURRENCY_ETH)
      .returns(ethers.FixedNumber.from(1));

    // Get total overflow across both terminals; should equal AMOUNT + AMOUNT
    expect(await jbEthPaymentTerminalStore.currentTotalOverflowOf(PROJECT_ID)).to.equal(
      AMOUNT.addUnsafe(AMOUNT),
    );
  });

  it(`Should return 0 total overflow if there's insufficient total ETH balance`, async function () {
    const {
      mockJbTerminalA,
      mockJbTerminalB,
      mockJbController,
      mockJbDirectory,
      mockJbFundingCycleStore,
      jbEthPaymentTerminalStore,
      timestamp,
      CURRENCY_ETH,
    } = await setup();

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      number: 1,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packFundingCycleMetadata(),
    });

    await mockJbDirectory.mock.terminalsOf
      .withArgs(PROJECT_ID)
      .returns([mockJbTerminalA.address, mockJbTerminalB.address]);

    await mockJbTerminalA.mock.ethBalanceOf.withArgs(PROJECT_ID).returns(AMOUNT);
    await mockJbTerminalB.mock.ethBalanceOf.withArgs(PROJECT_ID).returns(AMOUNT);

    await mockJbTerminalA.mock.remainingDistributionLimitOf
      .withArgs(PROJECT_ID, timestamp, 1)
      .returns(AMOUNT);
    await mockJbTerminalB.mock.remainingDistributionLimitOf
      .withArgs(PROJECT_ID, timestamp, 1)
      .returns(AMOUNT);

    await mockJbDirectory.mock.controllerOf.withArgs(PROJECT_ID).returns(mockJbController.address);

    await mockJbController.mock.distributionLimitCurrencyOf
      .withArgs(PROJECT_ID, timestamp, mockJbTerminalA.address)
      .returns(CURRENCY_ETH);
    await mockJbController.mock.distributionLimitCurrencyOf
      .withArgs(PROJECT_ID, timestamp, mockJbTerminalB.address)
      .returns(CURRENCY_ETH);

    // Get total overflow across both terminals
    expect(await jbEthPaymentTerminalStore.currentTotalOverflowOf(PROJECT_ID)).to.equal(0);
  });
});
