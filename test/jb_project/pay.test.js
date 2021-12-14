import { ethers } from 'hardhat';
import { expect } from 'chai';

import { deployMockContract } from '@ethereum-waffle/mock-contract';

import jbDirectory from '../../artifacts/contracts/JBDirectory.sol/JBDirectory.json';
import jbTerminal from '../../artifacts/contracts/interfaces/IJBTerminal.sol/IJBTerminal.json';

describe('JBProject::pay(...)', function () {
  const PROJECT_ID = 1;
  const BENEFICIARY = ethers.Wallet.createRandom().address;
  const TOKEN = ethers.Wallet.createRandom().address;
  const PREFER_CLAIMED_TOKENS = true;
  const MEMO = 'memo';

  async function setup() {
    let [deployer, ...addrs] = await ethers.getSigners();

    let mockJbDirectory = await deployMockContract(deployer, jbDirectory.abi);
    let mockJbTerminal = await deployMockContract(deployer, jbTerminal.abi);

    let jbFakeProjectFactory = await ethers.getContractFactory('JBFakeProject');
    let jbFakeProject = await jbFakeProjectFactory.deploy(PROJECT_ID, mockJbDirectory.address);

    return {
      deployer,
      addrs,
      mockJbDirectory,
      mockJbTerminal,
      jbFakeProject,
    };
  }

  it(`Should pay funds towards project`, async function () {
    const { jbFakeProject, mockJbDirectory, mockJbTerminal } = await setup();

    await mockJbDirectory.mock.primaryTerminalOf
      .withArgs(PROJECT_ID, TOKEN)
      .returns(mockJbTerminal.address);

    await mockJbTerminal.mock.pay
      .withArgs(PROJECT_ID, BENEFICIARY, 0, PREFER_CLAIMED_TOKENS, MEMO, [])
      .returns();

    await expect(
      jbFakeProject.pay(BENEFICIARY, MEMO, PREFER_CLAIMED_TOKENS, TOKEN, {
        value: ethers.utils.parseEther('1.0'),
      }),
    ).to.not.be.reverted;
  });

  it(`Fallback function should pay funds towards project`, async function () {
    const { jbFakeProject, mockJbDirectory, mockJbTerminal, addrs } = await setup();

    let caller = addrs[0];

    await mockJbDirectory.mock.primaryTerminalOf
      .withArgs(PROJECT_ID, ethers.constants.AddressZero)
      .returns(mockJbTerminal.address);

    await mockJbTerminal.mock.pay
      .withArgs(PROJECT_ID, caller.address, 0, /*preferClaimedTokens=*/ false, /*memo=*/ '', [])
      .returns();

    await expect(
      caller.sendTransaction({
        to: jbFakeProject.address,
        value: ethers.utils.parseEther('1.0'),
      }),
    ).to.not.be.reverted;
  });

  it(`Can't pay if project not found`, async function () {
    const { jbFakeProject } = await setup();

    // Set project id to zero.
    await jbFakeProject.setProjectId(0);

    await expect(
      jbFakeProject.pay(BENEFICIARY, MEMO, PREFER_CLAIMED_TOKENS, TOKEN),
    ).to.be.revertedWith('0x04: PROJECT_NOT_FOUND');
  });

  it(`Can't pay if terminal not found`, async function () {
    const { jbFakeProject, mockJbDirectory } = await setup();

    await mockJbDirectory.mock.primaryTerminalOf
      .withArgs(PROJECT_ID, TOKEN)
      .returns(ethers.constants.AddressZero);

    await expect(
      jbFakeProject.pay(BENEFICIARY, MEMO, PREFER_CLAIMED_TOKENS, TOKEN),
    ).to.be.revertedWith('0x05: TERMINAL_NOT_FOUND');
  });
});
