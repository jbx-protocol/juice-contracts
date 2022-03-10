import { expect } from 'chai';
import { ethers } from 'hardhat';
import { deployMockContract } from '@ethereum-waffle/mock-contract';

import { setBalance } from '../helpers/utils';
import errors from '../helpers/errors.json';

import jbDirectory from '../../artifacts/contracts/interfaces/IJBDirectory.sol/IJBDirectory.json';
import JBPaymentTerminalStore from '../../artifacts/contracts/JBPaymentTerminalStore.sol/JBPaymentTerminalStore.json';
import jbOperatoreStore from '../../artifacts/contracts/interfaces/IJBOperatorStore.sol/IJBOperatorStore.json';
import jbProjects from '../../artifacts/contracts/interfaces/IJBProjects.sol/IJBProjects.json';
import jbSplitsStore from '../../artifacts/contracts/interfaces/IJBSplitsStore.sol/IJBSplitsStore.json';

describe('JBPaymentTerminal::redeemTokensOf(...)', function () {
  const AMOUNT = 50000;
  const FUNDING_CYCLE_NUM = 1;
  const MEMO = 'test memo';
  const PROJECT_ID = 13;
  const WEIGHT = 1000;

  async function setup() {
    const [deployer, beneficiary, holder, otherCaller, terminalOwner] = await ethers.getSigners();

    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    const timestamp = block.timestamp;

    const [
      mockJbDirectory,
      mockJBPaymentTerminalStore,
      mockJbOperatorStore,
      mockJbProjects,
      mockJbSplitsStore,
    ] = await Promise.all([
      deployMockContract(deployer, jbDirectory.abi),
      deployMockContract(deployer, JBPaymentTerminalStore.abi),
      deployMockContract(deployer, jbOperatoreStore.abi),
      deployMockContract(deployer, jbProjects.abi),
      deployMockContract(deployer, jbSplitsStore.abi),
    ]);

    const jbCurrenciesFactory = await ethers.getContractFactory('JBCurrencies');
    const jbCurrencies = await jbCurrenciesFactory.deploy();
    const CURRENCY_ETH = await jbCurrencies.ETH();

    const jbTerminalFactory = await ethers.getContractFactory('JBETHPaymentTerminal', deployer);
    const currentNonce = await ethers.provider.getTransactionCount(deployer.address);
    const futureTerminalAddress = ethers.utils.getContractAddress({
      from: deployer.address,
      nonce: currentNonce + 1,
    });
    await mockJBPaymentTerminalStore.mock.claimFor.withArgs(futureTerminalAddress).returns();

    const jbEthPaymentTerminal = await jbTerminalFactory
      .connect(deployer)
      .deploy(
        CURRENCY_ETH,
        mockJbOperatorStore.address,
        mockJbProjects.address,
        mockJbDirectory.address,
        mockJbSplitsStore.address,
        mockJBPaymentTerminalStore.address,
        terminalOwner.address,
      );

    /* Lib constants */

    let jbOperationsFactory = await ethers.getContractFactory('JBOperations');
    let jbOperations = await jbOperationsFactory.deploy();
    const REDEEM_PERMISSION_INDEX = await jbOperations.REDEEM();

    /* Common mocks */

    await mockJbOperatorStore.mock.hasPermission
      .withArgs(holder.address, holder.address, PROJECT_ID, REDEEM_PERMISSION_INDEX)
      .returns(true);

    const fundingCycle = {
      number: FUNDING_CYCLE_NUM,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: WEIGHT,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: 0,
    };

    return {
      beneficiary,
      holder,
      jbEthPaymentTerminal,
      fundingCycle,
      mockJBPaymentTerminalStore,
      mockJbOperatorStore,
      otherCaller,
      timestamp,
    };
  }

  it('Should redeem tokens for overflow and emit event', async function () {
    const {
      beneficiary,
      fundingCycle,
      holder,
      jbEthPaymentTerminal,
      mockJBPaymentTerminalStore,
      timestamp,
    } = await setup();

    // Keep it simple and let 1 token exchange for 1 wei
    await mockJBPaymentTerminalStore.mock.recordRedemptionFor
      .withArgs(
        holder.address,
        PROJECT_ID,
        /* tokenCount */ AMOUNT,
        /* minReturnedWei */ AMOUNT,
        beneficiary.address,
        MEMO,
        /* delegateMetadata */ 0,
      )
      .returns(fundingCycle, /* reclaimAmount */ AMOUNT, MEMO);

    await setBalance(jbEthPaymentTerminal.address, AMOUNT);

    const initialBeneficiaryBalance = await ethers.provider.getBalance(beneficiary.address);

    const tx = await jbEthPaymentTerminal
      .connect(holder)
      .redeemTokensOf(
        holder.address,
        PROJECT_ID,
        /* tokenCount */ AMOUNT,
        /* minReturnedWei */ AMOUNT,
        beneficiary.address,
        MEMO,
        /* delegateMetadata */ 0,
      );

    expect(await tx)
      .to.emit(jbEthPaymentTerminal, 'RedeemTokens')
      .withArgs(
        /* _fundingCycle.configuration */ timestamp,
        /* _fundingCycle.number */ FUNDING_CYCLE_NUM,
        /* _projectId */ PROJECT_ID,
        /* _holder */ holder.address,
        /* _beneficiary */ beneficiary.address,
        /* _tokenCount */ AMOUNT,
        /* reclaimAmount */ AMOUNT,
        /* memo */ MEMO,
        /* msg.sender */ holder.address,
      );

    // Terminal should be out of ETH
    expect(await ethers.provider.getBalance(jbEthPaymentTerminal.address)).to.equal(0);

    // Beneficiary should have a larger balance
    expect(await ethers.provider.getBalance(beneficiary.address)).to.equal(
      initialBeneficiaryBalance.add(AMOUNT),
    );
  });

  it('Should not perform a transfer and only emit events if claim amount is 0', async function () {
    const {
      beneficiary,
      fundingCycle,
      holder,
      jbEthPaymentTerminal,
      mockJBPaymentTerminalStore,
      timestamp,
    } = await setup();

    // Keep it simple and let 1 token exchange for 1 wei
    await mockJBPaymentTerminalStore.mock.recordRedemptionFor
      .withArgs(
        holder.address,
        PROJECT_ID,
        /* tokenCount */ AMOUNT,
        /* minReturnedWei */ AMOUNT,
        beneficiary.address,
        MEMO,
        /* delegateMetadata */ 0,
      )
      .returns(fundingCycle, /* reclaimAmount */ 0, MEMO); // Set reclaimAmount to 0

    await setBalance(jbEthPaymentTerminal.address, AMOUNT);

    const initialBeneficiaryBalance = await ethers.provider.getBalance(beneficiary.address);

    const tx = await jbEthPaymentTerminal
      .connect(holder)
      .redeemTokensOf(
        holder.address,
        PROJECT_ID,
        /* tokenCount */ AMOUNT,
        /* minReturnedWei */ AMOUNT,
        beneficiary.address,
        MEMO,
        /* delegateMetadata */ 0,
      );

    expect(await tx)
      .to.emit(jbEthPaymentTerminal, 'RedeemTokens')
      .withArgs(
        /* _fundingCycle.configuration */ timestamp,
        /* _fundingCycle.number */ FUNDING_CYCLE_NUM,
        /* _projectId */ PROJECT_ID,
        /* _holder */ holder.address,
        /* _beneficiary */ beneficiary.address,
        /* _tokenCount */ AMOUNT,
        /* reclaimAmount */ 0,
        /* memo */ MEMO,
        /* msg.sender */ holder.address,
      );

    // Terminal's ETH balance should not have changed
    expect(await ethers.provider.getBalance(jbEthPaymentTerminal.address)).to.equal(AMOUNT);

    // Beneficiary should have the same balance
    expect(await ethers.provider.getBalance(beneficiary.address)).to.equal(
      initialBeneficiaryBalance,
    );
  });

  /* Sad path tests */

  it(`Can't redeem tokens for overflow without access`, async function () {
    const { beneficiary, holder, jbEthPaymentTerminal, mockJbOperatorStore, otherCaller } =
      await setup();

    await mockJbOperatorStore.mock.hasPermission.returns(false);

    await expect(
      jbEthPaymentTerminal
        .connect(otherCaller)
        .redeemTokensOf(
          holder.address,
          PROJECT_ID,
          /* tokenCount */ AMOUNT,
          /* minReturnedWei */ AMOUNT,
          beneficiary.address,
          MEMO,
          /* delegateMetadata */ 0,
        ),
    ).to.be.revertedWith(errors.UNAUTHORIZED);
  });

  it(`Can't redeem tokens for overflow if beneficiary is zero address`, async function () {
    const { holder, jbEthPaymentTerminal } = await setup();

    await expect(
      jbEthPaymentTerminal.connect(holder).redeemTokensOf(
        holder.address,
        PROJECT_ID,
        /* tokenCount */ AMOUNT,
        /* minReturnedWei */ AMOUNT,
        /* beneficiary */ ethers.constants.AddressZero, // Beneficiary address is 0
        MEMO,
        /* delegateMetadata */ 0,
      ),
    ).to.be.revertedWith(errors.REDEEM_TO_ZERO_ADDRESS);
  });
});
