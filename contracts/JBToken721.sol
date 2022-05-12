// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/Strings.sol';
import {ERC721 as ERC721Rari} from '@rari-capital/solmate/src/tokens/ERC721.sol';

import './interfaces/IJBToken721.sol';
import './interfaces/IJBToken721UriResolver.sol';

/**
  @notice
  An ERC-721 token that can be used by a project in the `JBNFTStore`.

  @dev
  Adheres to -
  IJBToken721: Allows this contract to be used by projects in the JBNFTStore.

  @dev
  Inherits from -
  ERC721: Rari Capital implementation.
  Ownable: Includes convenience functionality for checking a message sender's permissions before executing certain transactions.
*/
contract JBToken721 is ERC721Rari, IJBToken721, Ownable {
  using Strings for uint256;

  //*********************************************************************//
  // --------------------------- custom errors ------------------------- //
  //*********************************************************************//
  error INCORRECT_OWNER();
  error INVALID_ADDRESS();
  error INVALID_TOKEN();

  //*********************************************************************//
  // ------------------------- external views -------------------------- //
  //*********************************************************************//

  /**
    @notice
    The total supply of this ERC721.

    ignored: _projectId the ID of the project to which the token belongs. This is ignored.

    @return The total supply of this ERC721, as a fixed point number.
  */
  function totalSupply(uint256) external view override returns (uint256) {
    return _supply;
  }

  //*********************************************************************//
  // -------------------------- public views --------------------------- //
  //*********************************************************************//

  /**
    @notice
    Returns the full URI for the asset.
  */
  function tokenURI(uint256 tokenId) public view override returns (string memory) {
    if (ownerOf[tokenId] == address(0)) {
      revert INVALID_TOKEN();
    }

    if (address(_tokenUriResolver) != address(0)) {
      return _tokenUriResolver.tokenURI(tokenId);
    }

    return bytes(_baseUri).length > 0 ? string(abi.encodePacked(_baseUri, tokenId.toString())) : '';
  }

  /**
    @notice
    Returns the contract metadata uri.
  */
  function contractURI() public view override returns (string memory contractUri) {
    contractUri = _contractUri;
  }

  //*********************************************************************//
  // -------------------------- constructor ---------------------------- //
  //*********************************************************************//

  /**
    @notice
    Next token id to be minted.
  */
  uint256 private _nextTokenId;

  /**
    @notice
    Current supply.
  */
  uint256 private _supply;

  /**
    @notice
    Token base uri.
  */
  string private _baseUri;

  /**
    @notice
    Custom token uri resolver, superceeds base uri.
  */
  IJBToken721UriResolver private _tokenUriResolver;

  /**
    @notice
    Contract opensea-style metadata uri.
  */
  string private _contractUri;

  /**
    @param _name The name of the token.
    @param _symbol The symbol that the token should be represented by.
    @param _uri Token base URI.
    @param _tokenUriResolverAddress Custom uri resolver.
    @param _contractMetadataUri Contract metadata uri.
  */
  constructor(
    string memory _name,
    string memory _symbol,
    string memory _uri,
    IJBToken721UriResolver _tokenUriResolverAddress,
    string memory _contractMetadataUri
  ) ERC721Rari(_name, _symbol) {
    _baseUri = _uri;
    _tokenUriResolver = _tokenUriResolverAddress;
    _contractUri = _contractMetadataUri;
  }

  //*********************************************************************//
  // ---------------------- external transactions ---------------------- //
  //*********************************************************************//

  /**
    @notice
    Owner-only function to set a contract metadata uri to contain opensea-style metadata.

    @param _contractMetadataUri New metadata uri.
  */
  function setContractUri(string calldata _contractMetadataUri) external override onlyOwner {
    _contractUri = _contractMetadataUri;
  }

  /**
    @notice
    Owner-only function to set a new token base uri.

    @param _uri New base uri.
  */
  function setTokenUri(string calldata _uri) external override onlyOwner {
    _baseUri = _uri;
  }

  /**
    @notice
    Owner-only function to set a token uri resolver. If set to address(0), value of baseUri will be used instead.

    @param _tokenUriResolverAddress New uri resolver contract.
  */
  function setTokenUriResolver(IJBToken721UriResolver _tokenUriResolverAddress)
    external
    override
    onlyOwner
  {
    _tokenUriResolver = _tokenUriResolverAddress;
  }

  /**
    @notice
    Mints the next NFT id.

    @dev
    Only the owner of this contract can mint more of it.

    ignored: _projectId The ID of the project to which the token belongs. This is ignored.
    @param _account The account to mint the tokens for.
  */
  function mint(uint256 _projectId, address _account)
    external
    override
    onlyOwner
    returns (uint256)
  {
    _projectId; // Will not change the bytecode, but solc and natspec happiness are now achieved
    uint256 tokenId = _nextTokenId;
    _mint(_account, tokenId);

    _supply += 1;
    _nextTokenId += 1;

    return tokenId;
  }

  /**
    @notice
    Burn some outstanding tokens.

    @dev
    Only the owner of this contract cant burn some of its supply.

    ignored: _projectId The ID of the project to which the token belongs. This is ignored.
    @param _account The account to burn tokens from.
    @param _id The amount of tokens to burn, as a fixed point number with 18 decimals.
  */
  function burn(
    uint256,
    address _account,
    uint256 _id
  ) external override onlyOwner {
    if (ownerOf[_id] != _account) {
      revert INCORRECT_OWNER();
    }

    _burn(_id);

    _supply -= 1;
  }

  /**
    @notice
    Approves an account to spend tokens on the `msg.sender`s behalf.

    ignored: _projectId the ID of the project to which the token belongs. This is ignored.
    @param _spender The address that will be spending tokens on the `msg.sender`s behalf.
    @param _id NFT id to approve.
  */
  function approve(
    uint256,
    address _spender,
    uint256 _id
  ) external override {
    approve(_spender, _id);
  }

  /**
    @notice
    Transfer tokens to an account.

    ignored: _projectId The ID of the project to which the token belongs. This is ignored.
    @param _to The destination address.
    @param _id NFT id to transfer.
  */
  function transfer(
    uint256,
    address _to,
    uint256 _id
  ) external override {
    transferFrom(msg.sender, _to, _id);
  }

  /**
    @notice
    Transfer tokens between accounts.

    ignored: _projectId The ID of the project to which the token belongs. This is ignored.
    @param _from The originating address.
    @param _to The destination address.
    @param _id The amount of the transfer, as a fixed point number with 18 decimals.
  */
  function transferFrom(
    uint256,
    address _from,
    address _to,
    uint256 _id
  ) external override {
    transferFrom(_from, _to, _id);
  }

  /**
    @notice
    Returns the number of tokens held by the given address.
   */
  function ownerBalance(address _account) external view override returns (uint256) {
    if (_account == address(0)) {
      revert INVALID_ADDRESS();
    }

    return balanceOf[_account];
  }

  /**
    @notice
    Confirms that the given address owns the provided token.
   */
  function isOwner(address _account, uint256 _id) external view override returns (bool) {
    return ownerOf[_id] == _account;
  }

  function owner() public view override(IJBToken721, Ownable) returns (address) {
    return super.owner();
  }

  //*********************************************************************//
  // ------------------------ public transactions ---------------------- //
  //*********************************************************************//

  /**
    @notice
    Transfer ownership of this contract to another address.

    @dev
    Only the owner of this contract can transfer it.

    ignored: _projectId The ID of the project to which the token belongs. This is ignored.
    @param _newOwner The new owner.
  */
  function transferOwnership(uint256, address _newOwner) public override onlyOwner {
    return transferOwnership(_newOwner);
  }
}
