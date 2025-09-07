// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol"; // necessário para o override
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract DiplomaNFT is ERC721URIStorage, AccessControl {
    using Strings for uint256;

    bytes32 public constant INSTITUTION_ROLE = keccak256("INSTITUTION_ROLE");
    uint256 private _nextId = 1;

    mapping(uint256 => bool) public revoked;
    mapping(uint256 => string) public revokeReason;

    struct DiplomaCore {
        string studentName;
        string course;
        string institution;
        string graduationDate; // ISO 8601
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

    event DiplomaIssued(uint256 indexed tokenId, address indexed to, string tokenURI);
    event DiplomaRevoked(uint256 indexed tokenId, string reason);

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function mintDiploma(
        address to,
        string calldata uri,
        DiplomaCore calldata core
    ) external onlyRole(INSTITUTION_ROLE) returns (uint256 tokenId) {
        require(to != address(0), "invalid to");
        require(bytes(uri).length > 0, "uri required");

        tokenId = _nextId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        _core[tokenId] = core;

        emit DiplomaIssued(tokenId, to, uri);
    }

    function verifyDiploma(uint256 tokenId) public view returns (bool) {
        return _ownerOf(tokenId) != address(0) && !revoked[tokenId];
    }

    function revokeDiploma(uint256 tokenId, string calldata reason)
        external
        onlyRole(INSTITUTION_ROLE)
    {
        _requireOwned(tokenId);
        require(!revoked[tokenId], "already revoked");
        revoked[tokenId] = true;
        revokeReason[tokenId] = reason;
        emit DiplomaRevoked(tokenId, reason);
    }

    function getDiploma(uint256 tokenId) external view returns (DiplomaView memory v) {
        _requireOwned(tokenId);
        v = DiplomaView({
            tokenId: tokenId,
            holder: ownerOf(tokenId),
            revoked: revoked[tokenId],
            revokeReason: revokeReason[tokenId],
            tokenURIString: tokenURI(tokenId),
            core: _core[tokenId]
        });
    }

    // Impede transferências (só mint/burn)
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address from)
    {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) {
            revert("Soulbound: non-transferable");
        }
    }

    // Bloqueia aprovações
    function approve(address, uint256) public pure override(ERC721, IERC721) {
        revert("Soulbound: approvals disabled");
    }

    function setApprovalForAll(address, bool) public pure override(ERC721, IERC721) {
        revert("Soulbound: approvals disabled");
    }

    // Opcional: também bloquear consultas de aprovação
    function getApproved(uint256) public pure override(ERC721, IERC721) returns (address) {
        revert("Soulbound: approvals disabled");
    }

    function isApprovedForAll(address, address)
        public
        pure
        override(ERC721, IERC721)
        returns (bool)
    {
        return false;
    }

    // Resolver múltiplas heranças
   function supportsInterface(bytes4 interfaceId)
    public
    view
    override(ERC721URIStorage, AccessControl)
    returns (bool)
{
    return super.supportsInterface(interfaceId);
}


    // Helpers administrativos
    function grantInstitution(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(INSTITUTION_ROLE, account);
    }

    function revokeInstitution(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(INSTITUTION_ROLE, account);
    }
}
