// SPDX-License-Identifier: MIT
/* solhint-disable comprehensive-interface*/
pragma solidity 0.8.6;

import '@paulrberg/contracts/math/PRBMathUD60x18.sol';
import '@paulrberg/contracts/math/PRBMath.sol';

import './interfaces/IJBPrices.sol';
import './interfaces/IJBTokenStore.sol';
import './interfaces/IJBTerminal.sol';

import './libraries/JBConstants.sol';
import './libraries/JBOperations.sol';
import './libraries/JBSplitsGroups.sol';
import './libraries/JBFundingCycleMetadataResolver.sol';

//*********************************************************************//
// --------------------------- custom errors ------------------------- //
//*********************************************************************//
error CURRENCY_MISMATCH();
error DISTRIBUTION_AMOUNT_LIMIT_REACHED();
error FUNDING_CYCLE_PAYMENT_PAUSED();
error FUNDING_CYCLE_DISTRIBUTION_PAUSED();
error FUNDING_CYCLE_REDEEM_PAUSED();
error INADEQUATE_CONTROLLER_ALLOWANCE();
error INADEQUATE_PAYMENT_TERMINAL_STORE_BALANCE();
error INSUFFICIENT_TOKENS();
error INVALID_FUNDING_CYCLE();
error PAYMENT_TERMINAL_MIGRATION_NOT_ALLOWED();
error PAYMENT_TERMINAL_UNAUTHORIZED();
error STORE_ALREADY_CLAIMED();

/**
  @notice
  This contract manages all bookkeeping for inflows and outflows of a particular token for any IJBTerminal msg.sender.
*/
contract JBPaymentTerminalStore {
  // A library that parses the packed funding cycle metadata into a friendlier format.
  using JBFundingCycleMetadataResolver for JBFundingCycle;

  /**
    @notice
    The Projects contract which mints ERC-721's that represent project ownership and transfers.
  */
  IJBProjects public immutable projects;

  /**
    @notice
    The directory of terminals and controllers for projects.
  */
  IJBDirectory public immutable directory;

  /**
    @notice
    The contract storing all funding cycle configurations.
  */
  IJBFundingCycleStore public immutable fundingCycleStore;

  /**
    @notice
    The contract that manages token minting and burning.
  */
  IJBTokenStore public immutable tokenStore;

  /**
    @notice
    The contract that exposes price feeds.
  */
  IJBPrices public immutable prices;

  //*********************************************************************//
  // --------------------- public stored properties -------------------- //
  //*********************************************************************//

  /**
    @notice
    The amount of tokens that each project has for each terminal, in terms of the terminal's token.

    @dev
    The balance is represented as a fixed point number with 18 decimals.

    _terminalOf The terminal to which the balance applies.
    _projectId The ID of the project to get the balance of.
  */
  mapping(IJBTerminal => mapping(uint256 => uint256)) public balanceOf;

  /**
    @notice
    The amount of overflow (in the terminal's currency) that a project has used from its allowance during the current funding cycle configuration for each terminal, in terms of the terminal's token.

    @dev
    Increases as projects use their allowance.

    @dev
    The used allowance is represented as a fixed point number with 18 decimals.

    _terminalOf The terminal to which the overflow allowance applies.
    _projectId The ID of the project to get the used overflow allowance of.
    _configuration The configuration of the during which the allowance applies.
  */
  mapping(IJBTerminal => mapping(uint256 => mapping(uint256 => uint256)))
    public usedOverflowAllowanceOf;

  /**
    @notice
    The amount of tokens that a project has distributed from its limit during the current funding cycle for each terminal, in terms of the terminal's token.

    @dev
    Increases as projects use their distribution limit.

    @dev
    The used distribution limit is represented as a fixed point number with 18 decimals.

    _terminalOf The terminal to which the used distribution limit applies.
    _projectId The ID of the project to get the used distribution limit of.
    _fundingCycleNumber The number representing the funding cycle.
  */
  mapping(IJBTerminal => mapping(uint256 => mapping(uint256 => uint256)))
    public usedDistributionLimitOf;

  //*********************************************************************//
  // ------------------------- external views -------------------------- //
  //*********************************************************************//

  /**
    @notice
    Gets the current overflowed amount in a terminal for a specified project.

    @dev
    The current overflow is represented as a fixed point number with 18 decimals.

    @param _terminal The terminal for which the overflow is being calculated.
    @param _projectId The ID of the project to get overflow for.
    @param _currency The currency index relative to which the current overflow will be measured.

    @return The current amount of overflow that project has in this terminal.
  */
  function currentOverflowOf(
    IJBTerminal _terminal,
    uint256 _projectId,
    uint256 _currency
  ) external view returns (uint256) {
    // Get a reference to the project's current funding cycle.
    JBFundingCycle memory _fundingCycle = fundingCycleStore.currentOf(_projectId);

    return _overflowDuring(_terminal, _projectId, _fundingCycle, _currency);
  }

  /**
    @notice
    Gets the current overflowed amount for a specified project across all terminals.

    @dev
    The current total overflow is represented as a fixed point number with 18 decimals.

    @param _projectId The ID of the project to get total overflow for.
    @param _currency The currency index relative to which the total overflow will be measured.

    @return The current total amount of overflow that project has across all terminals.
  */
  function currentTotalOverflowOf(uint256 _projectId, uint256 _currency)
    external
    view
    returns (uint256)
  {
    // Get a reference to the project's current funding cycle.
    JBFundingCycle memory _fundingCycle = fundingCycleStore.currentOf(_projectId);

    return _totalOverflowDuring(_projectId, _fundingCycle, _currency);
  }

  /**
    @notice
    The amount of overflowed tokens that can be reclaimed by the specified number of tokens.

    @dev 
    If the project has an active funding cycle reconfiguration ballot, the project's ballot redemption rate is used.

    @dev
    The reclaimable overflow is represented as a fixed point number with 18 decimals.

    @param _terminal The terminal from which the overflow is being calculated.
    @param _projectId The ID of the project to get a reclaimable amount for.
    @param _tokenCount The number of tokens to make the calculation with, as a fixed point number with 18 decimals.
    @param _currency The currency index relative to which the current overflow will be measured.

    @return The amount of overflowed tokens that can be reclaimed.
  */
  function reclaimableOverflowOf(
    IJBTerminal _terminal,
    uint256 _projectId,
    uint256 _tokenCount,
    uint256 _currency
  ) external view returns (uint256) {
    return
      _reclaimableOverflowOf(
        _terminal,
        _projectId,
        fundingCycleStore.currentOf(_projectId),
        _tokenCount,
        _currency
      );
  }

  //*********************************************************************//
  // -------------------------- constructor ---------------------------- //
  //*********************************************************************//

  /**
    @param _prices A contract that exposes price feeds.
    @param _projects A contract which mints ERC-721's that represent project ownership and transfers.
    @param _directory A contract storing directories of terminals and controllers for each project.
    @param _fundingCycleStore A contract storing all funding cycle configurations.
    @param _tokenStore A contract that manages token minting and burning.
  */
  constructor(
    IJBPrices _prices,
    IJBProjects _projects,
    IJBDirectory _directory,
    IJBFundingCycleStore _fundingCycleStore,
    IJBTokenStore _tokenStore
  ) {
    prices = _prices;
    projects = _projects;
    directory = _directory;
    fundingCycleStore = _fundingCycleStore;
    tokenStore = _tokenStore;
  }

  //*********************************************************************//
  // ---------------------- external transactions ---------------------- //
  //*********************************************************************//

  /**
    @notice
    Records newly contributed tokens to a project.

    @dev
    Mint's the project's tokens according to values provided by a configured data source. If no data source is configured, mints tokens proportional to the amount of the contribution.

    @dev
    The msg.sender must be an IJBTerminal. The amount specified in the params is in terms of the msg.senders tokens.

    @param _payer The original address that sent the payment to the terminal.
    @param _amount The amount of terminal tokens being paid, as a fixed point number with 18 decimals.
    @param _projectId The ID of the project being paid.
    @param _beneficiary The address that should receive benefits from the payment.
    @param _memo A memo to pass along to the emitted event, and passed along the the funding cycle's data source and delegate.

    @return fundingCycle The project's funding cycle during which payment was made.
    @return weight The weight according to which new token supply was minted, as a fixed point number with 18 decimals.
    @return tokenCount The number of project tokens that were minted, as a fixed point number with 18 decimals.
    @return delegate A delegate contract to use for subsequent calls.
    @return memo A memo that should be passed along to the emitted event.
  */
  function recordPaymentFrom(
    address _payer,
    uint256 _amount,
    uint256 _projectId,
    address _beneficiary,
    string memory _memo
  )
    external
    returns (
      JBFundingCycle memory fundingCycle,
      uint256 weight,
      uint256 tokenCount,
      IJBPayDelegate delegate,
      string memory memo
    )
  {
    // Get a reference to the current funding cycle for the project.
    fundingCycle = fundingCycleStore.currentOf(_projectId);

    // The project must have a funding cycle configured.
    if (fundingCycle.number == 0) revert INVALID_FUNDING_CYCLE();

    // Must not be paused.
    if (fundingCycle.payPaused()) revert FUNDING_CYCLE_PAYMENT_PAUSED();

    // If the funding cycle has configured a data source, use it to derive a weight and memo.
    if (fundingCycle.useDataSourceForPay()) {
      (weight, memo, delegate) = fundingCycle.dataSource().payParams(
        JBPayParamsData(
          IJBTerminal(msg.sender),
          _payer,
          _amount,
          _projectId,
          fundingCycle.weight,
          fundingCycle.reservedRate(),
          _beneficiary,
          _memo
        )
      );
      // Otherwise use the funding cycle's weight
    } else {
      weight = fundingCycle.weight;
      memo = _memo;
    }

    // If there's no amount being recorded, there's nothing left to do.
    if (_amount == 0) return (fundingCycle, weight, 0, delegate, memo);

    // Add the amount to the token balance of the project if needed.
    balanceOf[IJBTerminal(msg.sender)][_projectId] =
      balanceOf[IJBTerminal(msg.sender)][_projectId] +
      _amount;

    // If there's no weight, token count must be 0 so there's nothing left to do.
    if (weight == 0) return (fundingCycle, weight, 0, delegate, memo);

    // Get a referenece to the terminal's currency.
    uint256 _terminalCurrency = IJBTerminal(msg.sender).currency();

    // Get a referenece to the terminal's base weight currency.
    uint256 _terminalBaseWeightCurrency = IJBTerminal(msg.sender).baseWeightCurrency();

    // If the terminal should base its weight on a different currency from the terminal's currency, determine the factor.
    uint256 _weightRatio = _terminalCurrency == _terminalBaseWeightCurrency
      ? 1E18
      : prices.priceFor(_terminalCurrency, _terminalBaseWeightCurrency);

    // Find the number of tokens to mint.
    tokenCount = PRBMath.mulDiv(_amount, weight, _weightRatio);
  }

  /**
    @notice
    Records newly distributed funds for a project.

    @dev
    The msg.sender must be an IJBTerminal. The amount specified in the params is in terms of the msg.senders tokens.

    @param _projectId The ID of the project that is having funds distributed.
    @param _amount The amount of terminal tokens to use from the distribution limit, as a fixed point number with 18 decimals.
    @param _currency The expected currency of the `_amount` being distributed. This must match the project's current funding cycle's currency.

    @return fundingCycle The funding cycle during which the distribution was made.
    @return distributedAmount The amount of terminal tokens distributed.
  */
  function recordDistributionFor(
    uint256 _projectId,
    uint256 _amount,
    uint256 _currency
  ) external returns (JBFundingCycle memory fundingCycle, uint256 distributedAmount) {
    // Get a reference to the project's current funding cycle.
    fundingCycle = fundingCycleStore.currentOf(_projectId);

    // The funding cycle must not be configured to have distributions paused.
    if (fundingCycle.distributionsPaused()) revert FUNDING_CYCLE_DISTRIBUTION_PAUSED();

    // The new total amount that has been distributed during this funding cycle.
    uint256 _newUsedDistributionLimitOf = usedDistributionLimitOf[IJBTerminal(msg.sender)][
      _projectId
    ][fundingCycle.number] + _amount;

    // Amount must be within what is still distributable.
    uint256 _distributionLimitOf = directory.controllerOf(_projectId).distributionLimitOf(
      _projectId,
      fundingCycle.configuration,
      IJBTerminal(msg.sender)
    );

    if (_newUsedDistributionLimitOf > _distributionLimitOf || _distributionLimitOf == 0)
      revert DISTRIBUTION_AMOUNT_LIMIT_REACHED();

    // Make sure the currencies match.
    if (
      _currency !=
      directory.controllerOf(_projectId).distributionLimitCurrencyOf(
        _projectId,
        fundingCycle.configuration,
        IJBTerminal(msg.sender)
      )
    ) revert CURRENCY_MISMATCH();

    // Get a referenece to the terminal's currency.
    uint256 _terminalCurrency = IJBTerminal(msg.sender).currency();

    // Convert the amount to this store's terminal's token.
    distributedAmount = (_currency == _terminalCurrency)
      ? _amount
      : PRBMathUD60x18.div(_amount, prices.priceFor(_currency, _terminalCurrency));

    // The amount being distributed must be available.
    if (distributedAmount > balanceOf[IJBTerminal(msg.sender)][_projectId])
      revert INADEQUATE_PAYMENT_TERMINAL_STORE_BALANCE();

    // Store the new amount.
    usedDistributionLimitOf[IJBTerminal(msg.sender)][_projectId][
      fundingCycle.number
    ] = _newUsedDistributionLimitOf;

    // Removed the distributed funds from the project's token balance.
    balanceOf[IJBTerminal(msg.sender)][_projectId] =
      balanceOf[IJBTerminal(msg.sender)][_projectId] -
      distributedAmount;
  }

  /**
    @notice
    Records newly used allowance funds of a project.

    @dev
    The msg.sender must be an IJBTerminal. The amount specified in the params is in terms of the msg.senders tokens.

    @param _projectId The ID of the project to use the allowance of.
    @param _amount The amount of terminal tokens to use from the allowance, as a fixed point number with 18 decimals.
    @param _currency The currency of the `_amount` value. Must match the funding cycle's currency.

    @return fundingCycle The funding cycle during which the withdrawal is being made.
    @return withdrawnAmount The amount terminal tokens used, as a fixed point number with 18 decimals.
  */
  function recordUsedAllowanceOf(
    uint256 _projectId,
    uint256 _amount,
    uint256 _currency
  ) external returns (JBFundingCycle memory fundingCycle, uint256 withdrawnAmount) {
    // Get a reference to the project's current funding cycle.
    fundingCycle = fundingCycleStore.currentOf(_projectId);

    // Get a reference to the new used overflow allowance.
    uint256 _newUsedOverflowAllowanceOf = usedOverflowAllowanceOf[IJBTerminal(msg.sender)][
      _projectId
    ][fundingCycle.configuration] + _amount;

    // There must be sufficient allowance available.
    uint256 _allowanceOf = directory.controllerOf(_projectId).overflowAllowanceOf(
      _projectId,
      fundingCycle.configuration,
      IJBTerminal(msg.sender)
    );

    if (_newUsedOverflowAllowanceOf > _allowanceOf || _allowanceOf == 0)
      revert INADEQUATE_CONTROLLER_ALLOWANCE();

    // Make sure the currencies match.
    if (
      _currency !=
      directory.controllerOf(_projectId).overflowAllowanceCurrencyOf(
        _projectId,
        fundingCycle.configuration,
        IJBTerminal(msg.sender)
      )
    ) revert CURRENCY_MISMATCH();

    // Get a referenece to the terminal's currency.
    uint256 _terminalCurrency = IJBTerminal(msg.sender).currency();

    // Convert the amount to this store's terminal's token.
    withdrawnAmount = (_currency == _terminalCurrency)
      ? _amount
      : PRBMathUD60x18.div(_amount, prices.priceFor(_currency, _terminalCurrency));

    // The project balance should be bigger than the amount withdrawn from the overflow
    if (balanceOf[IJBTerminal(msg.sender)][_projectId] < withdrawnAmount)
      revert INADEQUATE_PAYMENT_TERMINAL_STORE_BALANCE();

    // Get the current funding target
    uint256 distributionLimit = directory.controllerOf(_projectId).distributionLimitOf(
      _projectId,
      fundingCycle.configuration,
      IJBTerminal(msg.sender)
    );

    if (distributionLimit > 0) {
      uint256 _leftToDistribute = distributionLimit -
        usedDistributionLimitOf[IJBTerminal(msg.sender)][_projectId][fundingCycle.number];

      // Get the distribution limit currency (which might or might not be the same as the overflow allowance)
      uint256 _distributionLimitCurrency = directory
        .controllerOf(_projectId)
        .distributionLimitCurrencyOf(
          _projectId,
          fundingCycle.configuration,
          IJBTerminal(msg.sender)
        );

      // Convert the remaining to distribute into this store's terminal's token.
      _leftToDistribute = (_distributionLimitCurrency == _terminalCurrency)
        ? _leftToDistribute
        : PRBMathUD60x18.div(
          _leftToDistribute,
          prices.priceFor(_distributionLimitCurrency, _terminalCurrency)
        );

      // The amount being withdrawn must be available in the overflow.
      if (
        _leftToDistribute > balanceOf[IJBTerminal(msg.sender)][_projectId] ||
        withdrawnAmount > balanceOf[IJBTerminal(msg.sender)][_projectId] - _leftToDistribute
      ) revert INADEQUATE_PAYMENT_TERMINAL_STORE_BALANCE();
    }

    // Store the incremented value.
    usedOverflowAllowanceOf[IJBTerminal(msg.sender)][_projectId][
      fundingCycle.configuration
    ] = _newUsedOverflowAllowanceOf;

    // Update the project's token balance.
    balanceOf[IJBTerminal(msg.sender)][_projectId] =
      balanceOf[IJBTerminal(msg.sender)][_projectId] -
      withdrawnAmount;
  }

  /**
    @notice
    Records newly redeemed tokens of a project.

    @dev
    The msg.sender must be an IJBTerminal. The amount specified in the params is in terms of the msg.senders tokens.

    @param _holder The account that is having its tokens redeemed.
    @param _projectId The ID of the project to which the tokens being redeemed belong.
    @param _tokenCount The number of project tokens to redeem, as a fixed point number with 18 decimals.
    @param _beneficiary The address that will benefit from the claimed amount.
    @param _memo A memo to pass along to the emitted event.

    @return fundingCycle The funding cycle during which the redemption was made.
    @return reclaimAmount The amount of terminal tokens reclaimed, as a fixed point number with 18 decimals.
    @return delegate A delegate contract to use for subsequent calls.
    @return memo A memo that should be passed along to the emitted event.
  */
  function recordRedemptionFor(
    address _holder,
    uint256 _projectId,
    uint256 _tokenCount,
    address payable _beneficiary,
    string memory _memo
  )
    external
    returns (
      JBFundingCycle memory fundingCycle,
      uint256 reclaimAmount,
      IJBRedemptionDelegate delegate,
      string memory memo
    )
  {
    // The holder must have the specified number of the project's tokens.
    if (tokenStore.balanceOf(_holder, _projectId) < _tokenCount) revert INSUFFICIENT_TOKENS();

    // Get a reference to the project's current funding cycle.
    fundingCycle = fundingCycleStore.currentOf(_projectId);

    // The current funding cycle must not be paused.
    if (fundingCycle.redeemPaused()) revert FUNDING_CYCLE_REDEEM_PAUSED();

    // If the funding cycle has configured a data source, use it to derive a claim amount and memo.
    if (fundingCycle.useDataSourceForRedeem()) {
      (reclaimAmount, memo, delegate) = fundingCycle.dataSource().redeemParams(
        JBRedeemParamsData(
          IJBTerminal(msg.sender),
          _holder,
          _tokenCount,
          _projectId,
          fundingCycle.redemptionRate(),
          fundingCycle.ballotRedemptionRate(),
          _beneficiary,
          _memo
        )
      );
    } else {
      reclaimAmount = _reclaimableOverflowOf(
        IJBTerminal(msg.sender),
        _projectId,
        fundingCycle,
        _tokenCount,
        IJBTerminal(msg.sender).currency()
      );
      memo = _memo;
    }

    // The amount being reclaimed must be within the project's balance.
    if (reclaimAmount > balanceOf[IJBTerminal(msg.sender)][_projectId])
      revert INADEQUATE_PAYMENT_TERMINAL_STORE_BALANCE();

    // Remove the reclaimed funds from the project's balance.
    if (reclaimAmount > 0)
      balanceOf[IJBTerminal(msg.sender)][_projectId] =
        balanceOf[IJBTerminal(msg.sender)][_projectId] -
        reclaimAmount;
  }

  /**
    @notice
    Records newly added funds for the project.

    @dev
    The msg.sender must be an IJBTerminal. The amount specified in the params is in terms of the msg.senders tokens.

    @param _projectId The ID of the project to which the funds being added belong.
    @param _amount The amount of temrinal tokens added, as a fixed point number with 18 decimals.

    @return fundingCycle The current funding cycle for the project.
  */
  function recordAddedBalanceFor(uint256 _projectId, uint256 _amount)
    external
    returns (JBFundingCycle memory fundingCycle)
  {
    // Get a reference to the project's current funding cycle.
    fundingCycle = fundingCycleStore.currentOf(_projectId);

    // Increment the balance.
    balanceOf[IJBTerminal(msg.sender)][_projectId] =
      balanceOf[IJBTerminal(msg.sender)][_projectId] +
      _amount;
  }

  /**
    @notice
    Records the migration of funds from this store.

    @dev
    The msg.sender must be an IJBTerminal. The amount returned is in terms of the msg.senders tokens.

    @param _projectId The ID of the project being migrated.

    @return balance The project's current terminal token balance, as a fixed point number with 18 decimals.
  */
  function recordMigration(uint256 _projectId) external returns (uint256 balance) {
    // Get a reference to the project's current funding cycle.
    JBFundingCycle memory _fundingCycle = fundingCycleStore.currentOf(_projectId);

    // Migration must be allowed
    if (!_fundingCycle.terminalMigrationAllowed()) revert PAYMENT_TERMINAL_MIGRATION_NOT_ALLOWED();

    // Return the current balance.
    balance = balanceOf[IJBTerminal(msg.sender)][_projectId];

    // Set the balance to 0.
    balanceOf[IJBTerminal(msg.sender)][_projectId] = 0;
  }

  //*********************************************************************//
  // --------------------- private helper functions -------------------- //
  //*********************************************************************//

  /**
    @notice
    See docs for `reclaimableOverflowOf`
  */
  function _reclaimableOverflowOf(
    IJBTerminal _terminal,
    uint256 _projectId,
    JBFundingCycle memory _fundingCycle,
    uint256 _tokenCount,
    uint256 _currency
  ) private view returns (uint256) {
    // Get the amount of current overflow.
    // Use the local overflow if the funding cycle specifies that it should be used. Otherwise use the project's total overflow across all of its terminals.
    uint256 _currentOverflow = _fundingCycle.shouldUseLocalBalanceForRedemptions()
      ? _overflowDuring(_terminal, _projectId, _fundingCycle, _currency)
      : _totalOverflowDuring(_projectId, _fundingCycle, _currency);

    // If there is no overflow, nothing is claimable.
    if (_currentOverflow == 0) return 0;

    // Get the total number of tokens in circulation.
    uint256 _totalSupply = tokenStore.totalSupplyOf(_projectId);

    // Get the number of reserved tokens the project has.
    uint256 _reservedTokenAmount = directory.controllerOf(_projectId).reservedTokenBalanceOf(
      _projectId,
      _fundingCycle.reservedRate()
    );

    // If there are reserved tokens, add them to the total supply.
    if (_reservedTokenAmount > 0) _totalSupply = _totalSupply + _reservedTokenAmount;

    // If the amount being redeemed is the total supply, return the rest of the overflow.
    if (_tokenCount == _totalSupply) return _currentOverflow;

    // Use the ballot redemption rate if the queued cycle is pending approval according to the previous funding cycle's ballot.
    uint256 _redemptionRate = fundingCycleStore.currentBallotStateOf(_projectId) ==
      JBBallotState.Active
      ? _fundingCycle.ballotRedemptionRate()
      : _fundingCycle.redemptionRate();

    // If the redemption rate is 0, nothing is claimable.
    if (_redemptionRate == 0) return 0;

    // Get a reference to the linear proportion.
    uint256 _base = PRBMath.mulDiv(_currentOverflow, _tokenCount, _totalSupply);

    // These conditions are all part of the same curve. Edge conditions are separated because fewer operation are necessary.
    if (_redemptionRate == JBConstants.MAX_REDEMPTION_RATE) return _base;

    return
      PRBMath.mulDiv(
        _base,
        _redemptionRate +
          PRBMath.mulDiv(
            _tokenCount,
            JBConstants.MAX_REDEMPTION_RATE - _redemptionRate,
            _totalSupply
          ),
        JBConstants.MAX_REDEMPTION_RATE
      );
  }

  /**
    @notice
    Gets the amount that is overflowing when measured from the specified funding cycle.

    @dev
    This amount changes as the price of the terminal's token changes in relation to the currency being used to measure the distribution limit.

    @param _terminal The terminal for which the overflow is being calculated.
    @param _projectId The ID of the project to get overflow for.
    @param _fundingCycle The ID of the funding cycle to base the overflow on.
    @param _currency The currency index relative to which the total overflow will be measured.

    @return overflow The overflow of funds, as a fixed point number with 18 decimals.
  */
  function _overflowDuring(
    IJBTerminal _terminal,
    uint256 _projectId,
    JBFundingCycle memory _fundingCycle,
    uint256 _currency
  ) private view returns (uint256) {
    // Get the current balance of the project.
    uint256 _balanceOf = balanceOf[_terminal][_projectId];

    // If there's no balance, there's no overflow.
    if (_balanceOf == 0) return 0;

    // Get a reference to the amount still withdrawable during the funding cycle.
    uint256 _distributionRemaining = directory.controllerOf(_projectId).distributionLimitOf(
      _projectId,
      _fundingCycle.configuration,
      _terminal
    ) - usedDistributionLimitOf[_terminal][_projectId][_fundingCycle.number];

    // Get a reference to the current funding cycle's currency for this terminal.
    uint256 _distributionLimitCurrency = directory
      .controllerOf(_projectId)
      .distributionLimitCurrencyOf(_projectId, _fundingCycle.configuration, _terminal);

    // Convert the _distributionRemaining to this store's terminal's currency.
    uint256 _ethDistributionRemaining = _distributionRemaining == 0
      ? 0
      : (_distributionLimitCurrency == _currency)
      ? _distributionRemaining
      : PRBMathUD60x18.div(
        _distributionRemaining,
        prices.priceFor(_distributionLimitCurrency, _currency)
      );

    // Overflow is the balance of this project minus the amount that can still be distributed.
    return _balanceOf <= _ethDistributionRemaining ? 0 : _balanceOf - _ethDistributionRemaining;
  }

  /**
    @notice
    Gets the amount that is overflowing across all terminals in terms of this store's terminal's currency when measured from the specified funding cycle.

    @dev
    This amount changes as the price of the token changes in relation to the currency being used to measure the distribution limits.

    @param _projectId The ID of the project to get total overflow for.
    @param _fundingCycle The ID of the funding cycle to base the overflow on.
    @param _currency The currency index relative to which the total overflow will be measured.

    @return overflow The overflow of funds, as a fixed point number with 18 decimals
  */
  function _totalOverflowDuring(
    uint256 _projectId,
    JBFundingCycle memory _fundingCycle,
    uint256 _currency
  ) private view returns (uint256) {
    // Get a reference to the project's terminals.
    IJBTerminal[] memory _terminals = directory.terminalsOf(_projectId);

    // Keep a reference to the current balance of the project across all terminals in terms of the terminal's currency,
    // and the current distribution limit across all terminals in terms of the terminal's currency.
    uint256 _currencyBalanceOf;
    uint256 _currencyDistributionLimitRemaining;

    for (uint256 _i = 0; _i < _terminals.length; _i++) {
      // Get the balance of the terminal being iterated on.
      uint256 _someTerminalBalanceOf = _currencyBalanceOf + _terminals[_i].balanceOf(_projectId);

      // Get the currency of the terminal being iterated on.
      uint256 _someTerminalCurrency = _terminals[_i].currency();

      // Get the balance of the terminal in terms of this store's terminal's currency.
      _currencyBalanceOf = (_someTerminalCurrency == _currency)
        ? _someTerminalBalanceOf
        : PRBMathUD60x18.div(
          _someTerminalBalanceOf,
          prices.priceFor(_someTerminalCurrency, _currency)
        );

      // Get a reference to the amount still distributable during the funding cycle.
      uint256 _distributionRemaining = _terminals[_i].remainingDistributionLimitOf(
        _projectId,
        _fundingCycle.configuration,
        _fundingCycle.number
      );

      // Get a reference to the current funding cycle's currency for this terminal.
      uint256 _distributionLimitCurrency = directory
        .controllerOf(_projectId)
        .distributionLimitCurrencyOf(_projectId, _fundingCycle.configuration, _terminals[_i]);

      // Convert the _distributionRemaining to this store's terminal's token.
      _currencyDistributionLimitRemaining =
        _currencyDistributionLimitRemaining +
        (
          _distributionRemaining == 0 ? 0 : (_distributionLimitCurrency == _currency)
            ? _distributionRemaining
            : PRBMathUD60x18.div(
              _distributionRemaining,
              prices.priceFor(_distributionLimitCurrency, _currency)
            )
        );
    }

    // Overflow is the balance of this project minus the amount that can still be distributed.
    return
      _currencyBalanceOf <= _currencyDistributionLimitRemaining
        ? 0
        : _currencyBalanceOf - _currencyDistributionLimitRemaining;
  }
}