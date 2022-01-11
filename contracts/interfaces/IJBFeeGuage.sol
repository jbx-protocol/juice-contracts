// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import './IJBDirectory.sol';

interface IJBFeeGuage {
  function currentDiscountFor(uint256 _projectId) external view returns (uint256);
}
