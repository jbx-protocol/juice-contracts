// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import '@openzeppelin/contracts/access/Ownable.sol';

import './interfaces/IJBPrices.sol';

//*********************************************************************//
// --------------------------- custom errors ------------------------- //
//*********************************************************************//
error PRICE_FEED_ALREADY_EXISTS();
error PRICE_FEED_NOT_FOUND();

/** 
  @notice Manages and normalizes price feeds.

  @dev
  Adheres to:
  IJBPrices: General interface for the methods in this contract that interact with the blockchain's state according to the protocol's rules.

  @dev
  Inherits from:
  Ownable: Includes convenience functionality for checking a message sender's permissions before executing certain transactions.
*/
contract JBPrices is IJBPrices, Ownable {
  //*********************************************************************//
  // --------------------- public stored properties -------------------- //
  //*********************************************************************//

  /** 
    @notice 
    The available price feeds.

    _currency The currency of the feed.
    _base The currency the feed is based on.  
  */
  mapping(uint256 => mapping(uint256 => IJBPriceFeed)) public override feedFor;

  //*********************************************************************//
  // ------------------------- external views -------------------------- //
  //*********************************************************************//

  /** 
    @notice 
    Gets the current price of the provided currency in terms of the provided base currency.
    
    @param _currency The currency to get a price for.
    @param _base The currency to base the price on.
    @param _decimals The number of decimals the returned fixed point price should include.
    
    @return The price of the currency in terms of the base, as a fixed point number with the specified number of decimals.
  */
  function priceFor(
    uint256 _currency,
    uint256 _base,
    uint256 _decimals
  ) external view override returns (uint256) {
    // If the currency is the base, return 1 since they are priced the same. Include the desired number of decimals.
    if (_currency == _base) return 10**_decimals;

    // Get a reference to the feed.
    IJBPriceFeed _feed = feedFor[_currency][_base];

    // Feed must exist.
    if (_feed == IJBPriceFeed(address(0))) revert PRICE_FEED_NOT_FOUND();

    // Get the price.
    return _feed.currentPrice(_decimals);
  }

  //*********************************************************************//
  // ---------------------------- constructor -------------------------- //
  //*********************************************************************//

  /** 
    @param _owner The address that will own the contract.
  */
  constructor(address _owner) {
    // Transfer the ownership.
    transferOwnership(_owner);
  }

  //*********************************************************************//
  // ---------------------- external transactions ---------------------- //
  //*********************************************************************//

  /** 
    @notice 
    Add a price feed for a currency in terms of the provided base currency.

    @dev
    Current feeds can't be modified.

    @param _currency The currency that the price feed is for.
    @param _base The currency that the price feed is based on.
    @param _feed The price feed being added.
  */
  function addFeedFor(
    uint256 _currency,
    uint256 _base,
    IJBPriceFeed _feed
  ) external override onlyOwner {
    // There can't already be a feed for the specified currency.
    if (feedFor[_currency][_base] != IJBPriceFeed(address(0))) revert PRICE_FEED_ALREADY_EXISTS();

    // Store the feed.
    feedFor[_currency][_base] = _feed;

    emit AddFeed(_currency, _base, _feed);
  }
}
