import { expect } from 'chai';
import { ethers } from 'hardhat';

import { deployMockContract } from '@ethereum-waffle/mock-contract';

import jbDirectory from '../../artifacts/contracts/JBDirectory.sol/JBDirectory.json';
import jbOperatoreStore from '../../artifacts/contracts/JBOperatorStore.sol/JBOperatorStore.json';
import jbProjects from '../../artifacts/contracts/JBProjects.sol/JBProjects.json';
import errors from '../helpers/errors.json';

describe('JBTokenStore::transferTo(...)', function () {
  const PROJECT_ID = 2;
  const TOKEN_NAME = 'TestTokenDAO';
  const TOKEN_SYMBOL = 'TEST';

  async function setup() {
    const [deployer, controller, holder, recipient] = await ethers.getSigners();

    const jbOperationsFactory = await ethers.getContractFactory('JBOperations');
    const jbOperations = await jbOperationsFactory.deploy();

    const TRANSFER_INDEX = await jbOperations.TRANSFER();

    const mockJbOperatorStore = await deployMockContract(deployer, jbOperatoreStore.abi);
    const mockJbProjects = await deployMockContract(deployer, jbProjects.abi);
    const mockJbDirectory = await deployMockContract(deployer, jbDirectory.abi);

    const jbTokenStoreFactory = await ethers.getContractFactory('JBTokenStore');
    const jbTokenStore = await jbTokenStoreFactory.deploy(
      mockJbOperatorStore.address,
      mockJbProjects.address,
      mockJbDirectory.address,
    );

    return {
      controller,
      holder,
      recipient,
      mockJbDirectory,
      mockJbOperatorStore,
      jbTokenStore,
      TRANSFER_INDEX,
    };
  }

  it('Should transfer unclaimed tokens and emit event if caller has permission', async function () {
    const {
      controller,
      holder,
      recipient,
      mockJbDirectory,
      mockJbOperatorStore,
      jbTokenStore,
      TRANSFER_INDEX,
    } = await setup();

    await mockJbDirectory.mock.controllerOf.withArgs(PROJECT_ID).returns(controller.address);
    await mockJbOperatorStore.mock.hasPermission
      .withArgs(controller.address, holder.address, PROJECT_ID, TRANSFER_INDEX)
      .returns(true);

    // Issue tokens for project
    await jbTokenStore.connect(controller).issueFor(PROJECT_ID, TOKEN_NAME, TOKEN_SYMBOL);

    // Mint unclaimed tokens
    const numTokens = 20;
    await jbTokenStore.connect(controller).mintFor(holder.address, PROJECT_ID, numTokens, false);

    // Transfer unclaimed tokens to new recipient
    const transferToTx = await jbTokenStore
      .connect(controller)
      .transferTo(recipient.address, holder.address, PROJECT_ID, numTokens);

    expect(await jbTokenStore.unclaimedBalanceOf(holder.address, PROJECT_ID)).to.equal(0);
    expect(await jbTokenStore.unclaimedBalanceOf(recipient.address, PROJECT_ID)).to.equal(
      numTokens,
    );

    await expect(transferToTx)
      .to.emit(jbTokenStore, 'Transfer')
      .withArgs(holder.address, PROJECT_ID, recipient.address, numTokens, controller.address);
  });

  it(`Can't transfer unclaimed tokens to zero address`, async function () {
    const { controller, holder, mockJbOperatorStore, jbTokenStore, TRANSFER_INDEX } = await setup();

    await mockJbOperatorStore.mock.hasPermission
      .withArgs(controller.address, holder.address, PROJECT_ID, TRANSFER_INDEX)
      .returns(true);

    await expect(
      jbTokenStore
        .connect(controller)
        .transferTo(ethers.constants.AddressZero, holder.address, PROJECT_ID, /* amount= */ 1),
    ).to.be.revertedWith(errors.RECIPIENT_ZERO_ADDRESS);
  });

  it(`Can't transfer unclaimed tokens when recipient and holder are the same`, async function () {
    const { controller, holder, mockJbOperatorStore, jbTokenStore, TRANSFER_INDEX } = await setup();

    await mockJbOperatorStore.mock.hasPermission
      .withArgs(controller.address, holder.address, PROJECT_ID, TRANSFER_INDEX)
      .returns(true);

    await expect(
      jbTokenStore
        .connect(controller)
        .transferTo(holder.address, holder.address, PROJECT_ID, /* amount= */ 1),
    ).to.be.revertedWith(errors.INVALID_RECIPIENT);
  });

  it(`Can't transfer unclaimed tokens if amount is <= 0`, async function () {
    const { controller, holder, recipient, mockJbOperatorStore, jbTokenStore, TRANSFER_INDEX } =
      await setup();

    await mockJbOperatorStore.mock.hasPermission
      .withArgs(controller.address, holder.address, PROJECT_ID, TRANSFER_INDEX)
      .returns(true);

    await expect(
      jbTokenStore
        .connect(controller)
        .transferTo(recipient.address, holder.address, PROJECT_ID, /* amount= */ 0),
    ).to.be.revertedWith(errors.TOKEN_AMOUNT_ZERO);
  });

  it(`Can't transfer more unclaimed tokens than available balance`, async function () {
    const { controller, holder, recipient, mockJbOperatorStore, jbTokenStore, TRANSFER_INDEX } =
      await setup();

    await mockJbOperatorStore.mock.hasPermission
      .withArgs(controller.address, holder.address, PROJECT_ID, TRANSFER_INDEX)
      .returns(true);

    // 0 unclaimed tokens available, try to transfer 1
    await expect(
      jbTokenStore
        .connect(controller)
        .transferTo(recipient.address, holder.address, PROJECT_ID, /* amount= */ 1),
    ).to.be.revertedWith(errors.INSUFFICIENT_UNCLAIMED_TOKENS);
  });

  it(`Can't transfer unclaimed tokens if caller lacks permission`, async function () {
    const { controller, holder, recipient, mockJbOperatorStore, jbTokenStore, TRANSFER_INDEX } =
      await setup();

    await mockJbOperatorStore.mock.hasPermission
      .withArgs(controller.address, holder.address, PROJECT_ID, TRANSFER_INDEX)
      .returns(false);

    await expect(
      jbTokenStore
        .connect(controller)
        .transferTo(recipient.address, holder.address, PROJECT_ID, /* amount= */ 1),
    ).to.be.reverted;
  });
});
