// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import './IJBToken721UriResolver.sol';

interface IJBToken721 {
  function totalSupply(uint256) external view returns (uint256);

  function setContractUri(string calldata _contractMetadataUri) external;

  function setTokenUri(string calldata _contractMetadataUri) external;

  function setTokenUriResolver(IJBToken721UriResolver _tokenUriResolverAddress) external;

  function mint(uint256 _projectId, address _account) external returns (uint256);

  function burn(
    uint256 _projectId,
    address _account,
    uint256 _id
  ) external;

  function approve(
    uint256,
    address _spender,
    uint256 _id
  ) external;

  function transfer(
    uint256 _projectId,
    address _to,
    uint256 _id
  ) external;

  function transferFrom(
    uint256 _projectId,
    address _from,
    address _to,
    uint256 _id
  ) external;

  function transferOwnership(uint256 _projectId, address _newOwner) external;

  function ownerBalance(address _account) external view returns (uint256);

  function isOwner(address _account, uint256 _id) external view returns (bool);

  function contractURI() external view returns (string memory);

  function owner() external view returns (address);
}
