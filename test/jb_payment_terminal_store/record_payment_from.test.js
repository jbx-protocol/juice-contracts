import { expect } from 'chai';
import { ethers } from 'hardhat';

import { deployMockContract } from '@ethereum-waffle/mock-contract';

import errors from '../helpers/errors.json';
import { packFundingCycleMetadata, impersonateAccount } from '../helpers/utils';

import jbController from '../../artifacts/contracts/interfaces/IJBController.sol/IJBController.json';
import jbDirectory from '../../artifacts/contracts/interfaces/IJBDirectory.sol/IJBDirectory.json';
import jBFundingCycleStore from '../../artifacts/contracts/interfaces/IJBFundingCycleStore.sol/IJBFundingCycleStore.json';
import jbFundingCycleDataSource from '../../artifacts/contracts/interfaces/IJBFundingCycleDataSource.sol/IJBFundingCycleDataSource.json';
import jbPayDelegate from '../../artifacts/contracts/interfaces/IJBPayDelegate.sol/IJBPayDelegate.json';
import jbPrices from '../../artifacts/contracts/interfaces/IJBPrices.sol/IJBPrices.json';
import jbProjects from '../../artifacts/contracts/interfaces/IJBProjects.sol/IJBProjects.json';
import jbTerminal from '../../artifacts/contracts/interfaces/IJBTerminal.sol/IJBTerminal.json';
import jbTokenStore from '../../artifacts/contracts/interfaces/IJBTokenStore.sol/IJBTokenStore.json';

describe('JBPaymentTerminalStore::recordPaymentFrom(...)', function () {
  const PROJECT_ID = 2;
  const AMOUNT = ethers.BigNumber.from('4398541').mul(ethers.BigNumber.from(10).pow(18));
  const WEIGHT = ethers.BigNumber.from('90000').mul(ethers.BigNumber.from(10).pow(18));
  const WEIGHTED_AMOUNT = ethers.BigNumber.from('4398541').mul(ethers.BigNumber.from('90000')).mul(ethers.BigNumber.from(10).pow(18));
  const CURRENCY = 1;
  const BASE_CURRENCY = 1;

  async function setup() {
    const [deployer, payer, beneficiary] = await ethers.getSigners();

    const mockJbPrices = await deployMockContract(deployer, jbPrices.abi);
    const mockJbProjects = await deployMockContract(deployer, jbProjects.abi);
    const mockJbDirectory = await deployMockContract(deployer, jbDirectory.abi);
    const mockJbFundingCycleStore = await deployMockContract(deployer, jBFundingCycleStore.abi);
    const mockJbFundingCycleDataSource = await deployMockContract(
      deployer,
      jbFundingCycleDataSource.abi,
    );
    const mockJbPayDelegate = await deployMockContract(deployer, jbPayDelegate.abi);
    const mockJbTerminal = await deployMockContract(deployer, jbTerminal.abi);
    const mockJbTokenStore = await deployMockContract(deployer, jbTokenStore.abi);
    const mockJbController = await deployMockContract(deployer, jbController.abi);

    const JBPaymentTerminalStoreFactory = await ethers.getContractFactory(
      'JBPaymentTerminalStore',
    );
    const JBPaymentTerminalStore = await JBPaymentTerminalStoreFactory.deploy(
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

    await mockJbTerminal.mock.currency.returns(CURRENCY);
    await mockJbTerminal.mock.baseWeightCurrency.returns(BASE_CURRENCY);

    const mockJbTerminalSigner = await impersonateAccount(mockJbTerminal.address);

    return {
      mockJbTerminal,
      mockJbTerminalSigner,
      payer,
      beneficiary,
      mockJbController,
      mockJbDirectory,
      mockJbFundingCycleStore,
      mockJbFundingCycleDataSource,
      mockJbPayDelegate,
      mockJbPrices,
      JBPaymentTerminalStore,
      timestamp,
    };
  }

  /* Happy path tests with mockJbTerminal access */

  it('Should record payment without a datasource', async function () {
    const {
      mockJbTerminalSigner,
      payer,
      beneficiary,
      mockJbController,
      mockJbDirectory,
      mockJbFundingCycleStore,
      JBPaymentTerminalStore,
      mockJbTerminal,
      timestamp,
    } = await setup();

    // Set mockJbTerminal address
    await JBPaymentTerminalStore.claimFor(mockJbTerminal.address);

    const reservedRate = 0;

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // mock JBFundingCycle obj
      number: 1,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packFundingCycleMetadata({ pausePay: 0, reservedRate: reservedRate }),
    });

    await mockJbDirectory.mock.controllerOf.withArgs(PROJECT_ID).returns(mockJbController.address);

    await mockJbController.mock.mintTokensOf
      .withArgs(
        PROJECT_ID,
        WEIGHTED_AMOUNT,
        /* beneficiary */ beneficiary.address,
        /* memo */ '',
        /* preferClaimedTokens */ false,
        /* reservedRate */ reservedRate,
      )
      .returns(WEIGHTED_AMOUNT);

    expect(await JBPaymentTerminalStore.balanceOf(PROJECT_ID)).to.equal(0);

    // Record the payment
    const preferClaimedTokensBigNum = ethers.BigNumber.from(0); // false
    const beneficiaryBigNum = ethers.BigNumber.from(beneficiary.address).shl(1); // addr shifted left by 1
    await JBPaymentTerminalStore
      .connect(mockJbTerminalSigner)
      .recordPaymentFrom(
        /* payer */ payer.address,
        AMOUNT,
        PROJECT_ID,
        /* preferClaimedTokensAndBeneficiary */ preferClaimedTokensBigNum.or(beneficiaryBigNum),
        /* minReturnedTokens */ 0,
        /* memo */ 'test',
        /* delegateMetadata */ 0,
      );

    // Expect recorded balance to change
    expect(await JBPaymentTerminalStore.balanceOf(PROJECT_ID)).to.equal(AMOUNT);
  });
  it('Should record payment with no weight', async function () {
    const {
      mockJbTerminalSigner,
      payer,
      beneficiary,
      mockJbController,
      mockJbDirectory,
      mockJbFundingCycleStore,
      JBPaymentTerminalStore,
      mockJbTerminal,
      timestamp,
    } = await setup();

    // Set mockJbTerminal address
    await JBPaymentTerminalStore.claimFor(mockJbTerminal.address);

    const reservedRate = 0;

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // mock JBFundingCycle obj
      number: 1,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: 0,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packFundingCycleMetadata({ pausePay: 0, reservedRate: reservedRate }),
    });

    await mockJbDirectory.mock.controllerOf.withArgs(PROJECT_ID).returns(mockJbController.address);

    expect(await JBPaymentTerminalStore.balanceOf(PROJECT_ID)).to.equal(0);

    // Record the payment
    const preferClaimedTokensBigNum = ethers.BigNumber.from(0); // false
    const beneficiaryBigNum = ethers.BigNumber.from(beneficiary.address).shl(1); // addr shifted left by 1
    await JBPaymentTerminalStore
      .connect(mockJbTerminalSigner)
      .recordPaymentFrom(
        /* payer */ payer.address,
        AMOUNT,
        PROJECT_ID,
        /* preferClaimedTokensAndBeneficiary */ preferClaimedTokensBigNum.or(beneficiaryBigNum),
        /* minReturnedTokens */ 0,
        /* memo */ 'test',
        /* delegateMetadata */ 0,
      );

    // Expect recorded balance to change
    expect(await JBPaymentTerminalStore.balanceOf(PROJECT_ID)).to.equal(AMOUNT);
  });


  it('Should record payment with a datasource and emit event', async function () {
    const {
      mockJbTerminalSigner,
      payer,
      beneficiary,
      mockJbController,
      mockJbDirectory,
      mockJbFundingCycleStore,
      mockJbFundingCycleDataSource,
      mockJbPayDelegate,
      mockJbTerminal,
      JBPaymentTerminalStore,
      timestamp,
    } = await setup();

    // Set mockJbTerminal address
    await JBPaymentTerminalStore.claimFor(mockJbTerminal.address);


    const memo = 'test';
    const reservedRate = 0;
    const packedMetadata = packFundingCycleMetadata({
      pausePay: 0,
      reservedRate: reservedRate,
      useDataSourceForPay: 1,
      dataSource: mockJbFundingCycleDataSource.address,
    });

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // JBFundingCycle obj
      number: 1,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packedMetadata,
    });

    await mockJbDirectory.mock.controllerOf.withArgs(PROJECT_ID).returns(mockJbController.address);

    const delegateMetadata = [0];
    const newMemo = 'new memo';
    await mockJbFundingCycleDataSource.mock.payParams
      .withArgs({
        // JBPayParamsData obj
        payer: payer.address,
        amount: AMOUNT,
        projectId: PROJECT_ID,
        weight: WEIGHT,
        reservedRate: reservedRate,
        beneficiary: beneficiary.address,
        memo: memo,
        delegateMetadata: delegateMetadata,
      })
      .returns(WEIGHT, newMemo, mockJbPayDelegate.address, delegateMetadata);

    await mockJbController.mock.mintTokensOf
      .withArgs(
        PROJECT_ID,
        WEIGHTED_AMOUNT,
        /* beneficiary */ beneficiary.address,
        /* memo */ '',
        /* preferClaimedTokens */ false,
        /* reservedRate */ reservedRate,
      )
      .returns(WEIGHTED_AMOUNT);

    await mockJbPayDelegate.mock.didPay
      .withArgs({
        // JBDidPaydata obj
        payer: payer.address,
        projectId: PROJECT_ID,
        amount: AMOUNT,
        weight: WEIGHT,
        tokenCount: WEIGHTED_AMOUNT,
        beneficiary: beneficiary.address,
        memo: newMemo,
        delegateMetadata: delegateMetadata,
      })
      .returns();

    expect(await JBPaymentTerminalStore.balanceOf(PROJECT_ID)).to.equal(0);

    // Record the payment
    const preferClaimedTokensBigNum = ethers.BigNumber.from(0); // false
    const beneficiaryBigNum = ethers.BigNumber.from(beneficiary.address).shl(1); // addr shifted left by 1
    const tx = await JBPaymentTerminalStore
      .connect(mockJbTerminalSigner)
      .recordPaymentFrom(
        /* payer */ payer.address,
        /* amount */ AMOUNT,
        /* projectId */ PROJECT_ID,
        /* preferClaimedTokensAndBeneficiary */ preferClaimedTokensBigNum.or(beneficiaryBigNum),
        /* minReturnedTokens */ 0,
        /* memo */ memo,
        /* delegateMetadata */ delegateMetadata,
      );

    await expect(tx)
      .to.emit(JBPaymentTerminalStore, 'DelegateDidPay')
      .withArgs(mockJbPayDelegate.address, [
        /* payer */ payer.address,
        /* projectId */ PROJECT_ID,
        /* amount */ AMOUNT,
        /* weight */ WEIGHT,
        /* tokenCount */ WEIGHTED_AMOUNT,
        /* beneficiary */ beneficiary.address,
        /* memo */ newMemo,
        /* delegateMetadata */ ethers.BigNumber.from(delegateMetadata),
      ]);

    // Expect recorded balance to change
    expect(await JBPaymentTerminalStore.balanceOf(PROJECT_ID)).to.equal(AMOUNT);
  });

  it('Should record payment with a base weight currency that differs from the terminal currency', async function () {
    const {
      mockJbTerminalSigner,
      payer,
      beneficiary,
      mockJbController,
      mockJbDirectory,
      mockJbFundingCycleStore,
      JBPaymentTerminalStore,
      mockJbTerminal,
      mockJbPrices,
      timestamp,
    } = await setup();


    const reservedRate = 0;
    const otherBaseCurrency = 2;
    const conversionPrice = ethers.BigNumber.from(2);
    await mockJbTerminal.mock.baseWeightCurrency.returns(otherBaseCurrency);

    // Set mockJbTerminal address
    await JBPaymentTerminalStore.claimFor(mockJbTerminal.address);

    await mockJbPrices.mock.priceFor.withArgs(CURRENCY, otherBaseCurrency).returns(conversionPrice.mul(ethers.BigNumber.from(10).pow(18)));

    const ADAPTED_WEIGHTED_AMOUNT = WEIGHTED_AMOUNT.div(conversionPrice);

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // mock JBFundingCycle obj
      number: 1,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packFundingCycleMetadata({ pausePay: 0, reservedRate: reservedRate }),
    });

    await mockJbDirectory.mock.controllerOf.withArgs(PROJECT_ID).returns(mockJbController.address);

    await mockJbController.mock.mintTokensOf
      .withArgs(
        PROJECT_ID,
        ADAPTED_WEIGHTED_AMOUNT,
        /* beneficiary */ beneficiary.address,
        /* memo */ '',
        /* preferClaimedTokens */ false,
        /* reservedRate */ reservedRate,
      )
      .returns(ADAPTED_WEIGHTED_AMOUNT);

    expect(await JBPaymentTerminalStore.balanceOf(PROJECT_ID)).to.equal(0);

    // Record the payment
    const preferClaimedTokensBigNum = ethers.BigNumber.from(0); // false
    const beneficiaryBigNum = ethers.BigNumber.from(beneficiary.address).shl(1); // addr shifted left by 1
    await JBPaymentTerminalStore
      .connect(mockJbTerminalSigner)
      .recordPaymentFrom(
        /* payer */ payer.address,
        AMOUNT,
        PROJECT_ID,
        /* preferClaimedTokensAndBeneficiary */ preferClaimedTokensBigNum.or(beneficiaryBigNum),
        /* minReturnedTokens */ 0,
        /* memo */ 'test',
        /* delegateMetadata */ 0,
      );

    // Expect recorded balance to change
    expect(await JBPaymentTerminalStore.balanceOf(PROJECT_ID)).to.equal(AMOUNT);
  });

  it(`Should skip minting and recording payment if amount is 0`, async function () {
    const {
      mockJbTerminalSigner,
      payer,
      beneficiary,
      mockJbFundingCycleStore,
      mockJbFundingCycleDataSource,
      mockJbPayDelegate,
      JBPaymentTerminalStore,
      mockJbTerminal,
      timestamp,
    } = await setup();
    // Set mockJbTerminal address
    await JBPaymentTerminalStore.claimFor(mockJbTerminal.address);

    const memo = 'test';
    const reservedRate = 0;
    const packedMetadata = packFundingCycleMetadata({
      pausePay: 0,
      reservedRate: reservedRate,
      useDataSourceForPay: 1,
      dataSource: mockJbFundingCycleDataSource.address,
    });

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // JBFundingCycle obj
      number: 1,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packedMetadata,
    });

    const delegateMetadata = [0];
    const newMemo = 'new memo';
    await mockJbFundingCycleDataSource.mock.payParams
      .withArgs({
        // JBPayParamsData obj
        payer: payer.address,
        amount: 0,
        projectId: PROJECT_ID,
        weight: WEIGHT,
        reservedRate: reservedRate,
        beneficiary: beneficiary.address,
        memo: memo,
        delegateMetadata: delegateMetadata,
      })
      .returns(WEIGHT, newMemo, mockJbPayDelegate.address, delegateMetadata);

    await mockJbPayDelegate.mock.didPay
      .withArgs({
        // JBDidPaydata obj
        payer: payer.address,
        projectId: PROJECT_ID,
        amount: 0,
        weight: WEIGHT,
        tokenCount: 0,
        beneficiary: beneficiary.address,
        memo: newMemo,
        delegateMetadata: delegateMetadata,
      })
      .returns();

    expect(await JBPaymentTerminalStore.balanceOf(PROJECT_ID)).to.equal(0);

    // Record the payment
    const preferClaimedTokensBigNum = ethers.BigNumber.from(0); // false
    const beneficiaryBigNum = ethers.BigNumber.from(beneficiary.address).shl(1); // addr shifted left by 1
    const tx = await JBPaymentTerminalStore
      .connect(mockJbTerminalSigner)
      .recordPaymentFrom(
        /* payer */ payer.address,
        /* amount */ 0,
        /* projectId */ PROJECT_ID,
        /* preferClaimedTokensAndBeneficiary */ preferClaimedTokensBigNum.or(beneficiaryBigNum),
        /* minReturnedTokens */ 0,
        /* memo */ memo,
        /* delegateMetadata */ delegateMetadata,
      );

    // Recorded balance should not have changed
    expect(await JBPaymentTerminalStore.balanceOf(PROJECT_ID)).to.equal(0);

    await expect(tx)
      .to.emit(JBPaymentTerminalStore, 'DelegateDidPay')
      .withArgs(mockJbPayDelegate.address, [
        /* payer */ payer.address,
        /* projectId */ PROJECT_ID,
        /* amount */ 0,
        /* weight */ WEIGHT,
        /* tokenCount */ 0,
        /* beneficiary */ beneficiary.address,
        /* memo */ newMemo,
        /* delegateMetadata */ ethers.BigNumber.from(delegateMetadata),
      ]);
  });

  /* Sad path tests */

  it(`Can't record payment without mockJbTerminal access`, async function () {
    const { mockJbTerminal, payer, beneficiary, JBPaymentTerminalStore } = await setup();
    // Set mockJbTerminal address
    await JBPaymentTerminalStore.claimFor(mockJbTerminal.address);

    // Record the payment
    const preferClaimedTokensBigNum = ethers.BigNumber.from(0); // false
    const beneficiaryBigNum = ethers.BigNumber.from(beneficiary.address).shl(1); // addr shifted left by 1
    await expect(
      JBPaymentTerminalStore
        .connect(payer)
        .recordPaymentFrom(
          /* payer */ payer.address,
          AMOUNT,
          PROJECT_ID,
          /* preferClaimedTokensAndBeneficiary */ preferClaimedTokensBigNum.or(beneficiaryBigNum),
          /* minReturnedTokens */ 0,
          /* memo */ 'test',
          /* delegateMetadata */ 0,
        ),
    ).to.be.revertedWith(errors.UNAUTHORIZED);
  });

  it(`Can't record payment if fundingCycle hasn't been configured`, async function () {
    const { mockJbTerminalSigner, mockJbTerminal, payer, beneficiary, mockJbFundingCycleStore, JBPaymentTerminalStore } =
      await setup();

    // Set mockJbTerminal address
    await JBPaymentTerminalStore.claimFor(mockJbTerminal.address);

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // empty JBFundingCycle obj
      number: 0, // Set bad number
      configuration: 0,
      basedOn: 0,
      start: 0,
      duration: 0,
      weight: 0,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: 0,
    });

    // Record the payment
    const preferClaimedTokensBigNum = ethers.BigNumber.from(0); // false
    const beneficiaryBigNum = ethers.BigNumber.from(beneficiary.address).shl(1); // addr shifted left by 1
    await expect(
      JBPaymentTerminalStore
        .connect(mockJbTerminalSigner)
        .recordPaymentFrom(
          /* payer */ payer.address,
          AMOUNT,
          PROJECT_ID,
          /* preferClaimedTokensAndBeneficiary */ preferClaimedTokensBigNum.or(beneficiaryBigNum),
          /* minReturnedTokens */ 0,
          /* memo */ 'test',
          /* delegateMetadata */ 0,
        ),
    ).to.be.revertedWith(errors.INVALID_FUNDING_CYCLE);
  });

  it(`Can't record payment if fundingCycle has been paused`, async function () {
    const { mockJbTerminalSigner, mockJbTerminal, payer, beneficiary, mockJbFundingCycleStore, JBPaymentTerminalStore } =
      await setup();
    // Set mockJbTerminal address
    await JBPaymentTerminalStore.claimFor(mockJbTerminal.address);

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // mock JBFundingCycle obj
      number: 1,
      configuration: 0,
      basedOn: 0,
      start: 0,
      duration: 0,
      weight: 0,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packFundingCycleMetadata({ pausePay: 1 }), // Payments paused
    });

    // Record the payment
    const preferClaimedTokensBigNum = ethers.BigNumber.from(0); // false
    const beneficiaryBigNum = ethers.BigNumber.from(beneficiary.address).shl(1); // addr shifted left by 1
    await expect(
      JBPaymentTerminalStore
        .connect(mockJbTerminalSigner)
        .recordPaymentFrom(
          /* payer */ payer.address,
          AMOUNT,
          PROJECT_ID,
          /* preferClaimedTokensAndBeneficiary */ preferClaimedTokensBigNum.or(beneficiaryBigNum),
          /* minReturnedTokens */ 0,
          /* memo */ 'test',
          /* delegateMetadata */ 0,
        ),
    ).to.be.revertedWith(errors.FUNDING_CYCLE_PAYMENT_PAUSED);
  });

  it(`Can't record payment if tokens minted < minReturnedTokens`, async function () {
    const {
      mockJbTerminalSigner,
      payer,
      beneficiary,
      mockJbController,
      mockJbDirectory,
      mockJbFundingCycleStore,
      mockJbTerminal,
      JBPaymentTerminalStore,
      timestamp,
    } = await setup();
    // Set mockJbTerminal address
    await JBPaymentTerminalStore.claimFor(mockJbTerminal.address);

    const reservedRate = 0;
    const minReturnedAmt = WEIGHTED_AMOUNT.add(ethers.FixedNumber.from(1));

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      // mock JBFundingCycle obj
      number: 1,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: payer.address,
      metadata: packFundingCycleMetadata({ pausePay: 0, reservedRate: reservedRate }),
    });

    await mockJbDirectory.mock.controllerOf.withArgs(PROJECT_ID).returns(mockJbController.address);

    await mockJbController.mock.mintTokensOf
      .withArgs(
        PROJECT_ID,
        WEIGHTED_AMOUNT,
        /* beneficiary */ beneficiary.address,
        /* memo */ '',
        /* preferClaimedTokens */ false,
        /* reservedRate */ reservedRate,
      )
      .returns(WEIGHTED_AMOUNT);

    // Record the payment
    const preferClaimedTokensBigNum = ethers.BigNumber.from(0); // false
    const beneficiaryBigNum = ethers.BigNumber.from(beneficiary.address).shl(1); // addr shifted left by 1
    await expect(
      JBPaymentTerminalStore.connect(mockJbTerminalSigner).recordPaymentFrom(
        /* payer */ payer.address,
        AMOUNT,
        PROJECT_ID,
        /* preferClaimedTokensAndBeneficiary */ preferClaimedTokensBigNum.or(beneficiaryBigNum),
        /* minReturnedTokens */ ethers.FixedNumber.from(minReturnedAmt), // Set intentionally larger
        /* memo */ 'test',
        /* delegateMetadata */ 0,
      ),
    ).to.be.revertedWith(errors.INADEQUATE_TOKEN_COUNT);
  });
});
