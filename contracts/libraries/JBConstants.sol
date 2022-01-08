// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

/**
@notice
Global constants used across multiple Juicebox contracts.
*/
library JBConstants {
  /** 
    @notice
    Maximum value for reserved, redemption, and ballot redemption rates. Does not include discount rate.
  */
  uint256 public constant MAX_RESERVED_RATE = 10000;

  /**
    @notice
    Maximum token redemption rate to apply when there is an active ballot.
   */
  uint256 public constant MAX_BALLOT_REDEMPTION_RATE = 10000;

  /**
    @notice
    Maximum token redemption rate.  
    */
  uint256 public constant MAX_REDEMPTION_RATE = 10000;

  /** 
    @notice
    Maximum splits percentage.
  */
  uint256 public constant SPLITS_TOTAL_PERCENT = 10000000;
}
