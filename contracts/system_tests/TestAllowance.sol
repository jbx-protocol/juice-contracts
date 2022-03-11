// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import './helpers/TestBaseWorkflow.sol';

contract TestAllowance is TestBaseWorkflow {
  JBController controller;
  JBProjectMetadata _projectMetadata;
  JBFundingCycleData _data;
  JBFundingCycleMetadata _metadata;
  JBGroupedSplits[] _groupedSplits;
  JBFundAccessConstraints[] _fundAccessConstraints;
  IJBTerminal[] _terminals;
  JBTokenStore _tokenStore;
  address _projectOwner;

  uint256 WEIGHT = 1000 * 10**18;

  function setUp() public override {
    super.setUp();

    _projectOwner = multisig();

    _tokenStore = jbTokenStore();

    controller = jbController();

    _projectMetadata = JBProjectMetadata({content: 'myIPFSHash', domain: 1});

    _data = JBFundingCycleData({
      duration: 14,
      weight: WEIGHT,
      discountRate: 450000000,
      ballot: IJBFundingCycleBallot(address(0))
    });

    _metadata = JBFundingCycleMetadata({
      reservedRate: 5000,
      redemptionRate: 5000,
      ballotRedemptionRate: 0,
      pausePay: false,
      pauseDistributions: false,
      pauseRedeem: false,
      pauseMint: false,
      pauseBurn: false,
      allowChangeToken: false,
      allowTerminalMigration: false,
      allowControllerMigration: false,
      holdFees: false,
      useLocalBalanceForRedemptions: false,
      useDataSourceForPay: false,
      useDataSourceForRedeem: false,
      dataSource: IJBFundingCycleDataSource(address(0))
    });

    _terminals.push(jbETHPaymentTerminal());
  }

  function testAllowance() public {
    JBETHPaymentTerminal terminal = jbETHPaymentTerminal();

    _fundAccessConstraints.push(
      JBFundAccessConstraints({
        terminal: jbETHPaymentTerminal(),
        distributionLimit: 10 ether,
        overflowAllowance: 5 ether,
        distributionLimitCurrency: 1, // Currency = ETH
        overflowAllowanceCurrency: 1
      })
    );

    uint256 projectId = controller.launchProjectFor(
      _projectOwner,
      _projectMetadata,
      _data,
      _metadata,
      block.timestamp,
      _groupedSplits,
      _fundAccessConstraints,
      _terminals
    );

    terminal.pay{value: 20 ether}(20 ether, projectId, msg.sender, 0, false, 'Forge test', new bytes(0)); // funding target met and 10 ETH are now in the overflow

     // verify: beneficiary should have a balance of JBTokens (divided by 2 -> reserved rate = 50%)
    uint256 _userTokenBalance = PRBMathUD60x18.mul(20 ether, WEIGHT) / 2;
    assertEq(_tokenStore.balanceOf(msg.sender, projectId), _userTokenBalance);

    // verify: ETH balance in terminal should be up to date
    assertEq(terminal.balanceOf(projectId), 20 ether);

    // Discretionary use of overflow allowance by project owner (allowance = 5ETH)
    evm.prank(_projectOwner); // Prank only next call
    terminal.useAllowanceOf(
      projectId,
      5 ether,
      1, // Currency
      0, // Min wei out
      payable(msg.sender), // Beneficiary
      'MEMO'
    );
    assertEq((msg.sender).balance, 5 ether);

    // Distribute the funding target ETH -> no split then beneficiary is the project owner
    evm.prank(_projectOwner);
    terminal.distributePayoutsOf(
      projectId,
      10 ether,
      1, // Currency
      0, // Min wei out
      'Foundry payment' // Memo
    );
    assertEq(_projectOwner.balance, (10 ether * jbLibraries().MAX_FEE()) / (terminal.fee() + jbLibraries().MAX_FEE()) );

    // redeem eth from the overflow by the token holder:
    uint256 senderBalance = _tokenStore.balanceOf(msg.sender, projectId);
    evm.prank(msg.sender);
    terminal.redeemTokensOf(
      msg.sender,
      projectId,
      senderBalance,
      0,
      payable(msg.sender),
      'gimme my money back',
      new bytes(0)
    );

    // verify: beneficiary should have a balance of 0 JBTokens
    assertEq(_tokenStore.balanceOf(msg.sender, projectId), 0);
  }

  function testFuzzAllowance(uint248 ALLOWANCE, uint248 TARGET, uint96 BALANCE) public {
    JBETHPaymentTerminal terminal = jbETHPaymentTerminal();

    _fundAccessConstraints.push(
      JBFundAccessConstraints({
        terminal: jbETHPaymentTerminal(),
        distributionLimit: TARGET,
        overflowAllowance: ALLOWANCE,
        distributionLimitCurrency: 1, // Currency = ETH
        overflowAllowanceCurrency: 1
      })
    );

    uint256 projectId = controller.launchProjectFor(
      _projectOwner,
      _projectMetadata,
      _data,
      _metadata,
      block.timestamp,
      _groupedSplits,
      _fundAccessConstraints,
      _terminals
    );

    terminal.pay{value: BALANCE}(BALANCE, projectId, msg.sender, 0, false, 'Forge test', new bytes(0));

    // verify: beneficiary should have a balance of JBTokens (divided by 2 -> reserved rate = 50%)
    uint256 _userTokenBalance = PRBMathUD60x18.mul(BALANCE, WEIGHT) / 2;
    if(BALANCE != 0) assertEq(_tokenStore.balanceOf(msg.sender, projectId), _userTokenBalance);

    // verify: ETH balance in terminal should be up to date
    assertEq(terminal.balanceOf(projectId), BALANCE);

    evm.prank(_projectOwner);

    if (ALLOWANCE == 0)
      evm.expectRevert(abi.encodeWithSignature('INADEQUATE_CONTROLLER_ALLOWANCE()'));

    else if (TARGET >= BALANCE || ALLOWANCE > BALANCE) // Too much to withdraw or no overflow ?
      evm.expectRevert(abi.encodeWithSignature('INADEQUATE_PAYMENT_TERMINAL_STORE_BALANCE()'));
    
    terminal.useAllowanceOf(
      projectId,
      ALLOWANCE,
      1, // Currency
      0, // Min wei out
      payable(msg.sender), // Beneficiary
      'MEMO'
    );

    if (BALANCE !=0  && BALANCE > TARGET && ALLOWANCE < BALANCE && TARGET < BALANCE) assertEq((msg.sender).balance, ALLOWANCE);


    evm.prank(_projectOwner);
    if (TARGET > BALANCE)
      evm.expectRevert(abi.encodeWithSignature('INADEQUATE_PAYMENT_TERMINAL_STORE_BALANCE()'));
    
    if (TARGET == 0)
      evm.expectRevert(abi.encodeWithSignature('DISTRIBUTION_AMOUNT_LIMIT_REACHED()'));

    terminal.distributePayoutsOf(
      projectId,
      TARGET,
      1, // Currency
      0, // Min wei out
      'Foundry payment' // Memo
    );
    if (BALANCE !=0 && BALANCE > TARGET) assertEq(_projectOwner.balance, TARGET);

    evm.prank(msg.sender);

    if (BALANCE == 0)
      evm.expectRevert(abi.encodeWithSignature('INSUFFICIENT_TOKENS()'));

    terminal.redeemTokensOf(
      msg.sender,
      projectId,
      1, // Currency
      0, // Min wei out
      payable(msg.sender),
      'gimme my money back',
      new bytes(0)
    );
  }
}
