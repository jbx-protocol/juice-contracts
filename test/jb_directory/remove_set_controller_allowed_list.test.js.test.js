import { expect } from 'chai';
import { ethers } from 'hardhat';

import { deployMockContract } from '@ethereum-waffle/mock-contract';

import jbController from '../../artifacts/contracts/interfaces/IJBController.sol/IJBController.json';
import jbOperatoreStore from '../../artifacts/contracts/JBOperatorStore.sol/JBOperatorStore.json';
import jbProjects from '../../artifacts/contracts/JBProjects.sol/JBProjects.json';

describe('JBDirectory::removeFromSetControllerAllowlist(...)', function () {
  async function setup() {
    let [deployer, ...addrs] = await ethers.getSigners();

    let mockJbOperatorStore = await deployMockContract(deployer, jbOperatoreStore.abi);
    let mockJbProjects = await deployMockContract(deployer, jbProjects.abi);
    let mockJbController = await deployMockContract(deployer, jbController.abi);

    let jbDirectoryFactory = await ethers.getContractFactory('JBDirectory');
    let jbDirectory = await jbDirectoryFactory.deploy(
      mockJbOperatorStore.address,
      mockJbProjects.address,
    );

    return {
      deployer,
      addrs,
      jbDirectory,
      mockJbController
    };
  }

  it('Should remove known controller and emit events if caller is JBDirectory owner', async function () {
    const { deployer, jbDirectory, mockJbController } = await setup();
    await jbDirectory.connect(deployer).addToSetControllerAllowlist(mockJbController.address);

    await expect(
      jbDirectory.connect(deployer).removeFromSetControllerAllowlist(mockJbController.address)
    ).to.emit(jbDirectory, 'RemoveFromSetControllerAllowlist')
      .withArgs(mockJbController.address, deployer.address);
  });

  it('Can\'t remove known controller if caller is not JBDirectory owner', async function () {
    const { deployer, addrs, jbDirectory, mockJbController } = await setup();
    await jbDirectory.connect(deployer).addToSetControllerAllowlist(mockJbController.address);

    await expect(
      jbDirectory.connect(addrs[0]).removeFromSetControllerAllowlist(mockJbController.address)
    ).to.revertedWith('Ownable: caller is not the owner');
  });

  it('Can\'t remove a controller not in the known controller list', async function () {
    const { deployer, jbDirectory, mockJbController } = await setup();

    await expect(
      jbDirectory.connect(deployer).removeFromSetControllerAllowlist(mockJbController.address)
    ).to.revertedWith('0x31: NOT_FOUND');
  });

});
