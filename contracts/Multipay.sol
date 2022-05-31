//SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import './interfaces/IJBPaymentTerminal.sol';

contract Multipay {
    IJBPaymentTerminal public immutable jbTerminal;

    //uint256[] public _gasRefund = [28, 26, 24, 23, 22, 21, 19, 13, 11, 10, 4, 1];
    //uint256[] public _gasRefund = [26, 4, 3];

    constructor(IJBPaymentTerminal _jbTerminal) {
        jbTerminal = _jbTerminal;
    }

    function process(
        uint256[] calldata projectIds,
        address[] calldata beneficiaries,
        uint256[] calldata amounts,
        string[] calldata memos,
        uint256[] calldata projectsGas
        ) external payable {
            refundGas(projectsGas);
            processPay(
                projectIds,
                beneficiaries,
                amounts,
                memos
            );
        }

    function refundGas(uint256[] calldata _projects) public payable {
        for (uint256 i; i < _projects.length; ++i) {
            jbTerminal.addToBalanceOf{value: 0.2 ether}(
                _projects[i],
                0.2 ether,
                address(0),
                'gas refund',
                new bytes(0)
            );
        }
    }

    function processPay(
        uint256[] calldata projectIds,
        address[] calldata beneficiaries,
        uint256[] calldata amounts,
        string[] calldata memos
    ) public payable {
        for (uint256 i; i < projectIds.length; ++i) {
            jbTerminal.pay{value: amounts[i]}(
                projectIds[i],
                amounts[i],
                address(0),
                beneficiaries[i],
                0,
                true,
                memos[i],
                new bytes(0)
            );
        }

        if (payable(address(this)).balance > 0)
            payable(msg.sender).call{value: payable(address(this)).balance}('');
    }

    function computeTotalEthToSend(
        uint256[] calldata projectIds,
        address[] calldata beneficiaries,
        uint256[] calldata amounts,
        string[] calldata memos,
        uint256[] calldata gasToRefund
    ) external view returns (uint256 amount) {
        amount = 0.2 ether * gasToRefund.length;

        for (uint256 i; i < projectIds.length; ++i) {
            amount += amounts[i];
        }
    }
}
