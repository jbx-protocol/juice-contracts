const challengeHandle = require('./challenge_handle');
const createFor = require('./create_for');

module.exports = function () {
  before(async function () {
    this.operatorStore = await this.deployMockLocalContractFn('JBOperatorStore');
    this.contract = await this.deployContractFn('JBProjects', [this.operatorStore.address]);
  });

  describe('challengeHandle(...)', challengeHandle);
  describe('createFor(...)', createFor);
};
