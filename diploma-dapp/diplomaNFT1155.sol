// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155URIStorage.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract Diploma1155 is ERC1155URIStorage, ERC1155Supply, AccessControl {
    using Strings for uint256;

    bytes32 public constant INSTITUTION_ROLE = keccak256("INSTITUTION_ROLE");
    uint256 private _nextId = 1;

    mapping(uint256 => bool) public revoked;
    mapping(uint256 => string) public revokeReason;
    mapping(uint256 => address) private _holder;

    struct DiplomaCore {
        string studentName;
        string course;
        string institution;
        string graduationDate;
    }
    mapping(uint256 => DiplomaCore) private _core;

    struct DiplomaView {
        uint256 tokenId;
        address holder;
        bool revoked;
        string revokeReason;
        string tokenURIString;
        DiplomaCore core;
    }

    event DiplomaIssued(
        uint256 indexed tokenId,
        address indexed to,
        string tokenURI
    );
    event DiplomaRevoked(uint256 indexed tokenId, string reason);

    constructor() ERC1155("") {
        // base URI vazio; usaremos URI por token via URIStorage
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function mintDiploma(
        address to,
        string calldata uri_,
        DiplomaCore calldata core_
    ) external onlyRole(INSTITUTION_ROLE) returns (uint256 tokenId) {
        require(to != address(0), "invalid to");
        require(bytes(uri_).length > 0, "uri required");

        tokenId = _nextId++;
        _mint(to, tokenId, 1, ""); // amount = 1 (soulbound)
        _setURI(tokenId, uri_); // URI por token
        _core[tokenId] = core_;
        _holder[tokenId] = to;

        emit DiplomaIssued(tokenId, to, uri_);
    }

    // Resolve o diamante de herança para `uri(uint256)`
    function uri(uint256 id)
        public
        view
        override(ERC1155, ERC1155URIStorage)
        returns (string memory)
    {
        return super.uri(id);
    }

    function verifyDiploma(uint256 tokenId) public view returns (bool) {
        return totalSupply(tokenId) > 0 && !revoked[tokenId];
    }

    function revokeDiploma(uint256 tokenId, string calldata reason)
        external
        onlyRole(INSTITUTION_ROLE)
    {
        require(exists(tokenId), "nonexistent");
        require(!revoked[tokenId], "already revoked");
        revoked[tokenId] = true;
        revokeReason[tokenId] = reason;
        emit DiplomaRevoked(tokenId, reason);
    }

    function getDiploma(uint256 tokenId)
        external
        view
        returns (DiplomaView memory v)
    {
        require(exists(tokenId), "nonexistent");
        v = DiplomaView({
            tokenId: tokenId,
            holder: _holder[tokenId],
            revoked: revoked[tokenId],
            revokeReason: revokeReason[tokenId],
            tokenURIString: uri(tokenId),
            core: _core[tokenId]
        });
    }

    // BLOQUEIO DE TRANSFERÊNCIA + RESOLUÇÃO DE HERANÇA MÚLTIPLA (OZ v5)
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155, ERC1155Supply) {
        // impedir transfer entre carteiras; permitir mint (from=0) e burn (to=0)
        if (from != address(0) && to != address(0)) {
            revert("Soulbound: non-transferable");
        }

        super._update(from, to, ids, values);

        // manter _holder para supply=1 (mint/burn)
        unchecked {
            for (uint256 i = 0; i < ids.length; i++) {
                if (from == address(0) && to != address(0)) {
                    _holder[ids[i]] = to; // mint
                }
                if (to == address(0)) {
                    _holder[ids[i]] = address(0); // burn
                }
            }
        }
    }

    // 1155 possui approvals globais — desabilite-os
    function setApprovalForAll(address, bool) public pure override {
        revert("Soulbound: approvals disabled");
    }

    function isApprovedForAll(address, address)
        public
        pure
        override
        returns (bool)
    {
        return false;
    }

    // burn administrativo opcional
    function adminBurn(uint256 tokenId) external onlyRole(INSTITUTION_ROLE) {
        require(exists(tokenId), "nonexistent");
        address h = _holder[tokenId];
        if (h != address(0) && balanceOf(h, tokenId) > 0) {
            _burn(h, tokenId, 1);
        }
    }

    // supportsInterface com múltiplas heranças
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl, ERC1155)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
