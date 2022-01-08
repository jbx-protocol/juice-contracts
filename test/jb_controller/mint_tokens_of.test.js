import { expect } from 'chai';
import { ethers } from 'hardhat';
import { deployMockContract } from '@ethereum-waffle/mock-contract';
import { impersonateAccount, packFundingCycleMetadata } from '../helpers/utils';
import errors from '../helpers/errors.json';

import jbOperatoreStore from '../../artifacts/contracts/JBOperatorStore.sol/JBOperatorStore.json';
import jbProjects from '../../artifacts/contracts/JBProjects.sol/JBProjects.json';
import jbDirectory from '../../artifacts/contracts/JBDirectory.sol/JBDirectory.json';
import jbFundingCycleStore from '../../artifacts/contracts/JBFundingCycleStore.sol/JBFundingCycleStore.json';
import jbTokenStore from '../../artifacts/contracts/JBTokenStore.sol/JBTokenStore.json';
import jbSplitsStore from '../../artifacts/contracts/JBSplitsStore.sol/JBSplitsStore.json';
import jbToken from '../../artifacts/contracts/JBToken.sol/JBToken.json';
import jbTerminal from '../../artifacts/contracts/interfaces/IJBTerminal.sol/IJBTerminal.json';

describe('JBController::mintTokensOf(...)', function () {
  const PROJECT_ID = 1;
  const MEMO = 'Test Memo';
  const AMOUNT_TO_MINT = 20000;
  const RESERVED_RATE = 5000; // 50%
  const AMOUNT_TO_RECEIVE = AMOUNT_TO_MINT - (AMOUNT_TO_MINT * RESERVED_RATE) / 10000;

  let MINT_INDEX;

  before(async function () {
    let jbOperationsFactory = await ethers.getContractFactory('JBOperations');
    let jbOperations = await jbOperationsFactory.deploy();

    MINT_INDEX = await jbOperations.MINT();
  });

  async function setup() {
    let [deployer, projectOwner, beneficiary, ...addrs] = await ethers.getSigners();

    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    const timestamp = block.timestamp;

    let promises = [];

    promises.push(deployMockContract(deployer, jbOperatoreStore.abi));
    promises.push(deployMockContract(deployer, jbProjects.abi));
    promises.push(deployMockContract(deployer, jbDirectory.abi));
    promises.push(deployMockContract(deployer, jbFundingCycleStore.abi));
    promises.push(deployMockContract(deployer, jbTokenStore.abi));
    promises.push(deployMockContract(deployer, jbSplitsStore.abi));
    promises.push(deployMockContract(deployer, jbToken.abi));

    let [
      mockJbOperatorStore,
      mockJbProjects,
      mockJbDirectory,
      mockJbFundingCycleStore,
      mockTokenStore,
      mockSplitsStore,
      mockToken,
    ] = await Promise.all(promises);

    let jbControllerFactory = await ethers.getContractFactory('JBController');
    let jbController = await jbControllerFactory.deploy(
      mockJbOperatorStore.address,
      mockJbProjects.address,
      mockJbDirectory.address,
      mockJbFundingCycleStore.address,
      mockTokenStore.address,
      mockSplitsStore.address,
    );

    await mockJbProjects.mock.ownerOf.withArgs(PROJECT_ID).returns(projectOwner.address);

    await mockJbDirectory.mock.isTerminalDelegateOf
      .withArgs(PROJECT_ID, projectOwner.address)
      .returns(false);

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
      metadata: packFundingCycleMetadata({ pauseMint: 0, reservedRate: RESERVED_RATE }),
    });

    await mockTokenStore.mock.mintFor
      .withArgs(beneficiary.address, PROJECT_ID, AMOUNT_TO_RECEIVE, /*_preferClaimedTokens=*/ true)
      .returns();

    await mockTokenStore.mock.totalSupplyOf.withArgs(PROJECT_ID).returns(AMOUNT_TO_RECEIVE);

    return {
      projectOwner,
      beneficiary,
      addrs,
      jbController,
      mockJbOperatorStore,
      mockJbDirectory,
      mockJbFundingCycleStore,
      mockTokenStore,
      mockToken,
      timestamp,
    };
  }

  it(`Should mint token if caller is project owner and funding cycle not paused`, async function () {
    const { projectOwner, beneficiary, jbController } = await setup();

    await expect(
      jbController
        .connect(projectOwner)
        .mintTokensOf(
          PROJECT_ID,
          AMOUNT_TO_MINT,
          beneficiary.address,
          MEMO,
          /*_preferClaimedTokens=*/ true,
          RESERVED_RATE,
        ),
    )
      .to.emit(jbController, 'MintTokens')
      .withArgs(
        beneficiary.address,
        PROJECT_ID,
        AMOUNT_TO_MINT,
        MEMO,
        RESERVED_RATE,
        projectOwner.address,
      );

    let newReservedTokenBalance = await jbController.reservedTokenBalanceOf(
      PROJECT_ID,
      RESERVED_RATE,
    );
    expect(newReservedTokenBalance).to.equal(AMOUNT_TO_MINT - AMOUNT_TO_RECEIVE);
  });

  it(`Should mint token if caller is not project owner but is authorized`, async function () {
    const { projectOwner, beneficiary, addrs, jbController, mockJbOperatorStore, mockJbDirectory } =
      await setup();
    let caller = addrs[0];

    await mockJbOperatorStore.mock.hasPermission
      .withArgs(caller.address, projectOwner.address, PROJECT_ID, MINT_INDEX)
      .returns(true);

    await mockJbDirectory.mock.isTerminalDelegateOf
      .withArgs(PROJECT_ID, caller.address)
      .returns(false);

    await expect(
      jbController
        .connect(caller)
        .mintTokensOf(PROJECT_ID, AMOUNT_TO_MINT, beneficiary.address, MEMO, true, RESERVED_RATE),
    )
      .to.emit(jbController, 'MintTokens')
      .withArgs(
        beneficiary.address,
        PROJECT_ID,
        AMOUNT_TO_MINT,
        MEMO,
        RESERVED_RATE,
        caller.address,
      );

    let newReservedTokenBalance = await jbController.reservedTokenBalanceOf(
      PROJECT_ID,
      RESERVED_RATE,
    );
    expect(newReservedTokenBalance).to.equal(AMOUNT_TO_MINT - AMOUNT_TO_RECEIVE);
  });

  it(`Should mint token if caller is a terminal of the corresponding project`, async function () {
    const { projectOwner, beneficiary, jbController, mockJbOperatorStore, mockJbDirectory } =
      await setup();
    const terminal = await deployMockContract(projectOwner, jbTerminal.abi);
    const terminalSigner = await impersonateAccount(terminal.address);

    await mockJbOperatorStore.mock.hasPermission
      .withArgs(terminalSigner.address, projectOwner.address, PROJECT_ID, MINT_INDEX)
      .returns(false);

    await mockJbOperatorStore.mock.hasPermission
      .withArgs(terminalSigner.address, projectOwner.address, 0, MINT_INDEX)
      .returns(false);

    await mockJbDirectory.mock.isTerminalDelegateOf
      .withArgs(PROJECT_ID, terminalSigner.address)
      .returns(true);

    await expect(
      jbController
        .connect(terminalSigner)
        .mintTokensOf(PROJECT_ID, AMOUNT_TO_MINT, beneficiary.address, MEMO, true, RESERVED_RATE),
    )
      .to.emit(jbController, 'MintTokens')
      .withArgs(
        beneficiary.address,
        PROJECT_ID,
        AMOUNT_TO_MINT,
        MEMO,
        RESERVED_RATE,
        terminalSigner.address,
      );

    let newReservedTokenBalance = await jbController.reservedTokenBalanceOf(
      PROJECT_ID,
      RESERVED_RATE,
    );
    expect(newReservedTokenBalance).to.equal(AMOUNT_TO_MINT - AMOUNT_TO_RECEIVE);
  });

  it(`Can't mint token if beneficiary is zero address and reserved rate is not 100%`, async function () {
    const { projectOwner, jbController } = await setup();

    await expect(
      jbController
        .connect(projectOwner)
        .mintTokensOf(
          PROJECT_ID,
          AMOUNT_TO_MINT,
          ethers.constants.AddressZero,
          MEMO,
          true,
          RESERVED_RATE,
        ),
    ).to.be.revertedWith('INVALID_RESERVED_RATE_AND_BENEFICIARY_ZERO_ADDRESS()');
  });

  it(`Can't mint 0 token`, async function () {
    const { projectOwner, beneficiary, jbController } = await setup();

    await expect(
      jbController
        .connect(projectOwner)
        .mintTokensOf(PROJECT_ID, 0, beneficiary.address, MEMO, true, RESERVED_RATE),
    ).to.be.revertedWith(errors.ZERO_TOKENS_TO_MINT);
  });

  it(`Can't mint token if funding cycle is paused and caller is not a terminal delegate`, async function () {
    const { projectOwner, beneficiary, jbController, mockJbFundingCycleStore, timestamp } =
      await setup();

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
      metadata: packFundingCycleMetadata({ pauseMint: 1, reservedRate: RESERVED_RATE }),
    });

    await expect(
      jbController
        .connect(projectOwner)
        .mintTokensOf(PROJECT_ID, AMOUNT_TO_MINT, beneficiary.address, MEMO, true, RESERVED_RATE),
    ).to.be.revertedWith(errors.MINT_PAUSED_AND_NOT_TERMINAL_DELEGATE);
  });

  it(`Should mint token if funding cycle is paused and caller is a terminal delegate`, async function () {
    const {
      projectOwner,
      beneficiary,
      jbController,
      mockJbFundingCycleStore,
      mockJbOperatorStore,
      mockJbDirectory,
      timestamp,
    } = await setup();
    const terminal = await deployMockContract(projectOwner, jbTerminal.abi);
    const terminalSigner = await impersonateAccount(terminal.address);

    await mockJbOperatorStore.mock.hasPermission
      .withArgs(terminalSigner.address, projectOwner.address, PROJECT_ID, MINT_INDEX)
      .returns(false);

    await mockJbOperatorStore.mock.hasPermission
      .withArgs(terminalSigner.address, projectOwner.address, 0, MINT_INDEX)
      .returns(false);

    await mockJbDirectory.mock.isTerminalDelegateOf
      .withArgs(PROJECT_ID, terminalSigner.address)
      .returns(true);

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
      metadata: packFundingCycleMetadata({ pauseMint: 1, reservedRate: RESERVED_RATE }),
    });

    await expect(
      jbController
        .connect(terminalSigner)
        .mintTokensOf(PROJECT_ID, AMOUNT_TO_MINT, beneficiary.address, MEMO, true, RESERVED_RATE),
    )
      .to.emit(jbController, 'MintTokens')
      .withArgs(
        beneficiary.address,
        PROJECT_ID,
        AMOUNT_TO_MINT,
        MEMO,
        RESERVED_RATE,
        terminalSigner.address,
      );

    let newReservedTokenBalance = await jbController.reservedTokenBalanceOf(
      PROJECT_ID,
      RESERVED_RATE,
    );
    expect(newReservedTokenBalance).to.equal(AMOUNT_TO_MINT - AMOUNT_TO_RECEIVE);
  });

  it(`Should add the minted amount to the reserved tokens if reserved rate is 100%`, async function () {
    const {
      projectOwner,
      beneficiary,
      jbController,
      mockJbFundingCycleStore,
      mockTokenStore,
      timestamp,
    } = await setup();

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
      metadata: packFundingCycleMetadata({ reservedRate: 10000 }),
    });

    await mockTokenStore.mock.totalSupplyOf.withArgs(PROJECT_ID).returns(0);

    let previousReservedTokenBalance = await jbController.reservedTokenBalanceOf(
      PROJECT_ID,
      /*reservedRate=*/ 10000,
    );

    await expect(
      jbController
        .connect(projectOwner)
        .mintTokensOf(PROJECT_ID, AMOUNT_TO_MINT, beneficiary.address, MEMO, true, 10000),
    )
      .to.emit(jbController, 'MintTokens')
      .withArgs(beneficiary.address, PROJECT_ID, AMOUNT_TO_MINT, MEMO, 10000, projectOwner.address);

    let newReservedTokenBalance = await jbController.reservedTokenBalanceOf(PROJECT_ID, 10000);

    expect(newReservedTokenBalance).to.equal(previousReservedTokenBalance.add(AMOUNT_TO_MINT));
  });

  it(`Should substract the received amount to the reserved tokens if reserved rate is 0%`, async function () {
    const {
      projectOwner,
      beneficiary,
      jbController,
      mockJbFundingCycleStore,
      mockTokenStore,
      timestamp,
    } = await setup();

    await mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
      number: 1,
      configuration: timestamp,
      basedOn: timestamp,
      start: timestamp,
      duration: 0,
      weight: 0,
      discountRate: 0,
      ballot: ethers.constants.AddressZero,
      metadata: packFundingCycleMetadata({ reservedRate: 0 }),
    });

    await mockTokenStore.mock.totalSupplyOf.withArgs(PROJECT_ID).returns(AMOUNT_TO_MINT); // to mint == to receive <=> reserve rate = 0

    await mockTokenStore.mock.mintFor
      .withArgs(beneficiary.address, PROJECT_ID, AMOUNT_TO_MINT, true)
      .returns(); // to mint == to receive (reserve rate = 0)

    let previousReservedTokenBalance = await jbController.reservedTokenBalanceOf(
      PROJECT_ID,
      /*reservedRate=*/ 0,
    );

    await expect(
      jbController
        .connect(projectOwner)
        .mintTokensOf(PROJECT_ID, AMOUNT_TO_MINT, beneficiary.address, MEMO, true, 0),
    )
      .to.emit(jbController, 'MintTokens')
      .withArgs(beneficiary.address, PROJECT_ID, AMOUNT_TO_MINT, MEMO, 0, projectOwner.address);

    let newReservedTokenBalance = await jbController.reservedTokenBalanceOf(PROJECT_ID, 0);

    // reserved token cannot be < 0
    expect(newReservedTokenBalance).to.equal(
      Math.max(previousReservedTokenBalance.sub(AMOUNT_TO_MINT), 0),
    );
  });
});
