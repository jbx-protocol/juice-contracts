import { deployContract } from '../../../helpers/utils';

import hasPermission from './has_permission';
import hasPermissions from './has_permissions';
import setOperator from './set_operator';
import setOperators from './set_operators';

export default function () {
  // Before the tests, deploy the contract.
  before(async function () {
    this.contract = await deployContract('JBOperatorStore');
  });

  describe('setOperator(...)', setOperator);
  describe('setOperators(...)', setOperators);
  describe('hasPermission(...)', hasPermission);
  describe('hasPermissions(...)', hasPermissions);
}
