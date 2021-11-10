import { expect } from 'chai';
import { getAddresses } from '../../../utils';

let addrs;

const tests = {
  success: [
    {
      description: 'appoint',
      fn: ({ governance }) => ({
        caller: governance,
        governance: addrs[0],
      }),
    },
  ],
  failure: [
    {
      description: 'unauthorized',
      fn: ({ governance }) => ({
        caller: governance,
        revert: 'TerminalV1::acceptGovernance: UNAUTHORIZED',
      }),
    },
  ],
};

export default function () {
  before(async function () {
    addrs = await getAddresses();
  });
  describe('Success cases', function () {
    tests.success.forEach(function (successTest) {
      it(successTest.description, async function () {
        const { caller, governance } = successTest.fn(this);

        // Appoint the governance that will accept.
        await this.targetContract.connect(caller).appointGovernance(governance.address);

        // Execute the transaction.
        const tx = await this.targetContract.connect(governance).acceptGovernance();

        // Expect an event to have been emitted.
        await expect(tx)
          .to.emit(this.targetContract, 'AcceptGovernance')
          .withArgs(governance.address);

        // Get the stored pending governance value.
        const storedGovernance = await this.targetContract.governance();

        // Expect the stored value to equal whats expected.
        expect(storedGovernance).to.equal(governance.address);
      });
    });
  });
  describe('Failure cases', function () {
    tests.failure.forEach(function (failureTest) {
      it(failureTest.description, async function () {
        const { caller, revert } = failureTest.fn(this);

        await expect(this.targetContract.connect(caller).acceptGovernance()).to.be.revertedWith(
          revert,
        );
      });
    });
  });
}
