const { ethers } = require('hardhat');
const toFundBack = require("./toFundBack.json")
const JBTerminal = require("../deployments/mainnet/JBETHPaymentTerminal.json");

/**
 * Deploy and use a multipayer contract
 * 
 * Example usage:
 *
 * npx hardhat deploy --network rinkeby --tag 3
 */
module.exports = async ({ deployments, getChainId }) => {
  console.log("Deploying multipayer & send payment");

  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  let multisigAddress;
  let chainId = await getChainId();
  let baseDeployArgs = {
    from: deployer.address,
    log: true,
    skipIfAlreadyDeployed: true,
  };

  console.log({ deployer: deployer.address, chain: chainId });

  switch (chainId) {
    // mainnet
    case '1':
      multisigAddress = '0xAF28bcB48C40dBC86f52D459A6562F658fc94B1e';
      break;
    // rinkeby
    case '4':
      multisigAddress = '0xAF28bcB48C40dBC86f52D459A6562F658fc94B1e';
      break;
    // hardhat / localhost
    case '31337':
      multisigAddress = deployer.address;
      break;
  }

  console.log({ multisigAddress });

  const multipay = await deploy('Multipay', {
    ...baseDeployArgs,
    args: [JBTerminal.address],
  });

  let projectId = [];
  let amounts = [];
  let beneficiaries = [];
  let memos = [];

  for(let i=0; i < toFundBack.length; i++) {
    projectId[i] = toFundBack[i].projectId;
    beneficiaries[i] = toFundBack[i].beneficiaries;
    amounts[i] = toFundBack[i].amounts;
    memos[i] = toFundBack[i].memos;
  }

  const ethToSend = await multipay.computeTotalEthToSend(
    projectId,
    beneficiaries,
    amounts,
    memos
  );

  console.log('about to send '+ethToSend+'wei');

  await multipay.process(
    projectId,
    beneficiaries,
    amounts,
    memos,
    {value: ethToSend}
  );

  console.log('Done');
};

module.exports.tags = ['3'];
module.exports.dependencies = ['1']; 