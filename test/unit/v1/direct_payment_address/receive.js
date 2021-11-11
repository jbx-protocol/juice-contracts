import hardhat from 'hardhat';
const {
  ethers: { constants },
} = hardhat;
import { expect } from 'chai';
import { getAddresses, getDeployer } from '../../../helpers/utils';

let deployer;
let addrs;

const tests = {
  success: [
    {
      description: 'no preset beneficiary or preference for unstaked tickets',
      fn: () => ({
        caller: deployer,
        beneficiary: deployer.address,
        preferUnstakedTickets: false,
        // below values doesnt matter
        value: 1,
      }),
    },
    {
      description: 'preset beneficiary, preset preference for unstaked tickets',
      fn: () => ({
        caller: deployer,
        beneficiary: addrs[0].address,
        preferUnstakedTickets: true,
        // below values doesnt matter
        value: 1,
      }),
    },
  ],
};

export default function () {
  before(async function () {
    deployer = await getDeployer();
    addrs = await getAddresses();
  });

  describe('Success cases', function () {
    tests.success.forEach(function (successTest) {
      it(successTest.description, async function () {
        const { caller, value, beneficiary, preferUnstakedTickets } = successTest.fn(this);

        await this.terminalV1.mock.pay
          .withArgs(this.projectId, beneficiary, this.memo, preferUnstakedTickets)
          .returns(1);
        await this.terminalDirectory.mock.unstakedTicketsPreferenceOf
          .withArgs(caller.address)
          .returns(preferUnstakedTickets);
        await this.terminalDirectory.mock.beneficiaryOf
          .withArgs(caller.address)
          .returns(beneficiary || constants.AddressZero);
        await this.terminalDirectory.mock.terminalOf
          .withArgs(this.projectId)
          .returns(this.terminalV1.address);

        // Execute the transaction.
        const tx = await caller.sendTransaction({
          to: this.contract.address,
          value,
        });

        // Expect an event to have been emitted.
        await expect(tx)
          .to.emit(this.contract, 'Forward')
          .withArgs(
            caller.address,
            this.projectId,
            beneficiary,
            value,
            this.memo,
            preferUnstakedTickets,
          );
      });
    });
  });
}
