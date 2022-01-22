import { expect } from 'chai';
import { ethers } from 'hardhat';

import { deployMockContract } from '@ethereum-waffle/mock-contract';

import errors from '../helpers/errors.json';
import { packFundingCycleMetadata } from '../helpers/utils';

import jbController from '../../artifacts/contracts/interfaces/IJBController.sol/IJBController.json';
import jbDirectory from '../../artifacts/contracts/interfaces/IJBDirectory.sol/IJBDirectory.json';
import jBFundingCycleStore from '../../artifacts/contracts/interfaces/IJBFundingCycleStore.sol/IJBFundingCycleStore.json';
import jbPrices from '../../artifacts/contracts/interfaces/IJBPrices.sol/IJBPrices.json';
import jbProjects from '../../artifacts/contracts/interfaces/IJBProjects.sol/IJBProjects.json';
import jbTokenStore from '../../artifacts/contracts/interfaces/IJBTokenStore.sol/IJBTokenStore.json';

describe('JBETHPaymentTerminalStore::recordDistributionFor(...)', function () {
  const FUNDING_CYCLE_NUM = 1;
  const PROJECT_ID = 2;
  const AMOUNT = ethers.FixedNumber.fromString('4398541.345');
  const WEIGHT = ethers.FixedNumber.fromString('900000000.23411');

  async function setup() {
    const [deployer, terminal, addr] = await ethers.getSigners();

    const mockJbPrices = await deployMockContract(deployer, jbPrices.abi);
    const mockJbProjects = await deployMockContract(deployer, jbProjects.abi);
    const mockJbDirectory = await deployMockContract(deployer, jbDirectory.abi);
    const mockJbFundingCycleStore = await deployMockContract(deployer, jBFundingCycleStore.abi);
    const mockJbTokenStore = await deployMockContract(deployer, jbTokenStore.abi);
    const mockJbController = await deployMockContract(deployer, jbController.abi);

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

    /* Common mocks */

    // Set terminal address
    await jbEthPaymentTerminalStore.claimFor(terminal.address);

    // Set controller address
    await mockJbDirectory.mock.controllerOf.withArgs(PROJECT_ID).returns(mockJbController.address);

    return {
      terminal,
      addr,
      mockJbController,
      mockJbFundingCycleStore,
      mockJbPrices,
      jbEthPaymentTerminalStore,
      timestamp,
      CURRENCY_ETH,
      CURRENCY_USD,
    };
  }

  it('Should record distribution with terminal access', async function () {
    const {
      terminal,
      mockJbController,
      mockJbFundingCycleStore,
      mockJbPrices,
      jbEthPaymentTerminalStore,
      timestamp,
      CURRENCY_ETH,
      CURRENCY_USD,
    } = await setup();

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // mock JBFundingCycle obj
      number: FUNDING_CYCLE_NUM,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packFundingCycleMetadata({ pauseDistributions: 0 }),
    });

    const usdToEthPrice = ethers.FixedNumber.from(10000);
    const amountInWei = AMOUNT.divUnsafe(usdToEthPrice);

    // Add to balance beforehand
    await jbEthPaymentTerminalStore
      .connect(terminal)
      .recordAddedBalanceFor(PROJECT_ID, amountInWei);

    await mockJbController.mock.currencyOf
      .withArgs(PROJECT_ID, timestamp, terminal.address)
      .returns(CURRENCY_USD);

    await mockJbController.mock.distributionLimitOf
      .withArgs(PROJECT_ID, timestamp, terminal.address)
      .returns(AMOUNT);

    await mockJbPrices.mock.priceFor.withArgs(CURRENCY_USD, CURRENCY_ETH).returns(usdToEthPrice);

    // Pre-checks
    expect(
      await jbEthPaymentTerminalStore.usedDistributionLimitOf(PROJECT_ID, FUNDING_CYCLE_NUM),
    ).to.equal(0);
    expect(await jbEthPaymentTerminalStore.balanceOf(PROJECT_ID)).to.equal(amountInWei);

    // Record the distributions
    await jbEthPaymentTerminalStore
      .connect(terminal)
      .recordDistributionFor(PROJECT_ID, AMOUNT, CURRENCY_USD, /* minReturnedWei */ amountInWei);

    // Post-checks
    expect(
      await jbEthPaymentTerminalStore.usedDistributionLimitOf(PROJECT_ID, FUNDING_CYCLE_NUM),
    ).to.equal(AMOUNT);
    expect(await jbEthPaymentTerminalStore.balanceOf(PROJECT_ID)).to.equal(0);
  });

  /* Sad path tests */

  it(`Can't record distribution without terminal access`, async function () {
    const { addr, jbEthPaymentTerminalStore, CURRENCY_ETH } = await setup();

    // Record the distributions
    await expect(
      jbEthPaymentTerminalStore
        .connect(addr)
        .recordDistributionFor(PROJECT_ID, AMOUNT, CURRENCY_ETH, /* minReturnedWei */ AMOUNT),
    ).to.be.revertedWith(errors.UNAUTHORIZED);
  });

  it(`Can't record distribution if distributions are paused`, async function () {
    const {
      terminal,
      mockJbFundingCycleStore,
      jbEthPaymentTerminalStore,
      timestamp,
      CURRENCY_ETH,
    } = await setup();

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // mock JBFundingCycle obj
      number: FUNDING_CYCLE_NUM,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packFundingCycleMetadata({ pauseDistributions: 1 }),
    });

    // Record the distributions
    await expect(
      jbEthPaymentTerminalStore
        .connect(terminal)
        .recordDistributionFor(PROJECT_ID, AMOUNT, CURRENCY_ETH, /* minReturnedWei */ AMOUNT),
    ).to.be.revertedWith(errors.FUNDING_CYCLE_DISTRIBUTION_PAUSED);
  });

  it(`Can't record distribution if currency param doesn't match controller's currency`, async function () {
    const {
      terminal,
      mockJbController,
      mockJbFundingCycleStore,
      jbEthPaymentTerminalStore,
      timestamp,
      CURRENCY_ETH,
      CURRENCY_USD,
    } = await setup();

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // mock JBFundingCycle obj
      number: FUNDING_CYCLE_NUM,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packFundingCycleMetadata({ pauseDistributions: 0 }),
    });

    await mockJbController.mock.currencyOf
      .withArgs(PROJECT_ID, timestamp, terminal.address)
      .returns(CURRENCY_USD);

    // Record the distributions
    await expect(
      jbEthPaymentTerminalStore
        .connect(terminal)
        .recordDistributionFor(PROJECT_ID, AMOUNT, CURRENCY_ETH, /* minReturnedWei */ AMOUNT), // Use ETH instead of expected USD
    ).to.be.revertedWith(errors.CURRENCY_MISMATCH);
  });

  it(`Can't record distribution if distributionLimit is exceeded`, async function () {
    const {
      terminal,
      mockJbController,
      mockJbFundingCycleStore,
      mockJbPrices,
      jbEthPaymentTerminalStore,
      timestamp,
      CURRENCY_ETH,
    } = await setup();

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // mock JBFundingCycle obj
      number: FUNDING_CYCLE_NUM,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packFundingCycleMetadata({ pauseDistributions: 0 }),
    });

    // Add to balance beforehand
    await jbEthPaymentTerminalStore.connect(terminal).recordAddedBalanceFor(PROJECT_ID, AMOUNT);

    await mockJbController.mock.currencyOf
      .withArgs(PROJECT_ID, timestamp, terminal.address)
      .returns(CURRENCY_ETH);

    const smallDistributionLimit = AMOUNT.subUnsafe(ethers.FixedNumber.from(1));
    await mockJbController.mock.distributionLimitOf
      .withArgs(PROJECT_ID, timestamp, terminal.address)
      .returns(smallDistributionLimit); // Set intentionally small distribution limit

    await mockJbPrices.mock.priceFor
      .withArgs(CURRENCY_ETH, CURRENCY_ETH)
      .returns(ethers.FixedNumber.from(1));

    // Record the distributions
    await expect(
      jbEthPaymentTerminalStore
        .connect(terminal)
        .recordDistributionFor(PROJECT_ID, AMOUNT, CURRENCY_ETH, /* minReturnedWei */ AMOUNT),
    ).to.be.revertedWith(errors.DISTRIBUTION_AMOUNT_LIMIT_REACHED);
  });

  it(`Can't record distribution if distributedAmount > project's total balance`, async function () {
    const {
      terminal,
      mockJbController,
      mockJbFundingCycleStore,
      mockJbPrices,
      jbEthPaymentTerminalStore,
      timestamp,
      CURRENCY_ETH,
    } = await setup();

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // mock JBFundingCycle obj
      number: FUNDING_CYCLE_NUM,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packFundingCycleMetadata({ pauseDistributions: 0 }),
    });

    // Add intentionally small balance
    const smallBalance = AMOUNT.subUnsafe(ethers.FixedNumber.from(1));
    await jbEthPaymentTerminalStore
      .connect(terminal)
      .recordAddedBalanceFor(PROJECT_ID, smallBalance);

    await mockJbController.mock.currencyOf
      .withArgs(PROJECT_ID, timestamp, terminal.address)
      .returns(CURRENCY_ETH);

    await mockJbController.mock.distributionLimitOf
      .withArgs(PROJECT_ID, timestamp, terminal.address)
      .returns(AMOUNT);

    await mockJbPrices.mock.priceFor
      .withArgs(CURRENCY_ETH, CURRENCY_ETH)
      .returns(ethers.FixedNumber.from(1));

    // Record the distributions
    await expect(
      jbEthPaymentTerminalStore
        .connect(terminal)
        .recordDistributionFor(PROJECT_ID, AMOUNT, CURRENCY_ETH, /* minReturnedWei */ AMOUNT),
    ).to.be.revertedWith(errors.INSUFFICIENT_FUND_FOR_DISTRIBUTION);
  });

  it(`Can't record distribution if minReturnedWei > distributedAmount`, async function () {
    const {
      terminal,
      mockJbController,
      mockJbFundingCycleStore,
      mockJbPrices,
      jbEthPaymentTerminalStore,
      timestamp,
      CURRENCY_ETH,
    } = await setup();

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // mock JBFundingCycle obj
      number: FUNDING_CYCLE_NUM,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packFundingCycleMetadata({ pauseDistributions: 0 }),
    });

    // Add to balance beforehand
    await jbEthPaymentTerminalStore.connect(terminal).recordAddedBalanceFor(PROJECT_ID, AMOUNT);

    await mockJbController.mock.currencyOf
      .withArgs(PROJECT_ID, timestamp, terminal.address)
      .returns(CURRENCY_ETH);

    await mockJbController.mock.distributionLimitOf
      .withArgs(PROJECT_ID, timestamp, terminal.address)
      .returns(AMOUNT);

    await mockJbPrices.mock.priceFor
      .withArgs(CURRENCY_ETH, CURRENCY_ETH)
      .returns(ethers.FixedNumber.from(1));

    // Record the distributions
    const minReturnedWei = AMOUNT.addUnsafe(ethers.FixedNumber.from(1));
    await expect(
      jbEthPaymentTerminalStore.connect(terminal).recordDistributionFor(
        PROJECT_ID,
        AMOUNT,
        CURRENCY_ETH,
        /* minReturnedWei */ minReturnedWei, // Set intentionally large
      ),
    ).to.be.revertedWith(errors.INSUFFICIENT_FUND_FOR_DISTRIBUTION);
  });
});
