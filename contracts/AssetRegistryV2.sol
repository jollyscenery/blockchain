// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Proposed V2 - local tests only; never a replacement for the existing Sepolia deployment
/// Role: Admin (kelola role), Manager (tambah/ubah/hapus aset), Editor (tambah/ubah aset), Viewer (hanya baca)
contract AssetRegistryV2 {
    enum Role { None, Viewer, Editor, Manager, Admin }

    struct Asset {
        uint256 id;
        string name;
        string category;
        string location;
        string condition;
        address custodian;
        address createdBy;
        uint64 createdAt;
        uint64 updatedAt;
        bool active; // false = sudah dihapus (soft delete)
    }

    mapping(address => Role) private roles;
    address[] private members;
    mapping(address => bool) private isMember;

    Asset[] private assets;

    event RoleChanged(address indexed account, Role role, address indexed by);
    event AssetCreated(uint256 indexed id, address indexed by);
    event AssetUpdated(uint256 indexed id, address indexed by);
    event AssetDeleted(uint256 indexed id, address indexed by);

    modifier atLeast(Role r) {
        require(uint8(roles[msg.sender]) >= uint8(r), "Akses ditolak: role tidak cukup");
        _;
    }

    constructor() {
        _setRole(msg.sender, Role.Admin);
    }

    // ---------- Role management (Admin) ----------
    function setRole(address account, Role role) external atLeast(Role.Admin) {
        require(account != address(0), "Alamat tidak valid");
        require(role != Role.None, "Gunakan revokeRole");
        require(!(account == msg.sender && role != Role.Admin), "Admin tidak boleh menurunkan diri sendiri");
        _setRole(account, role);
    }

    function revokeRole(address account) external atLeast(Role.Admin) {
        require(account != address(0), "Alamat tidak valid");
        require(account != msg.sender, "Tidak bisa mencabut role sendiri");
        require(roles[account] != Role.None, "Wallet belum memiliki role");
        _setRole(account, Role.None);
    }

    function _setRole(address account, Role role) internal {
        if (!isMember[account]) { isMember[account] = true; members.push(account); }
        roles[account] = role;
        emit RoleChanged(account, role, msg.sender);
    }

    function getRole(address account) external view returns (Role) { return roles[account]; }

    uint256 public constant MAX_PAGE_SIZE = 25;
    uint256 public constant MAX_TEXT_BYTES = 256;

    function getMembersPage(uint256 cursor, uint256 limit) external view atLeast(Role.Admin)
        returns (address[] memory addrs, Role[] memory rs, uint256 nextCursor)
    {
        uint256 length = members.length;
        require(limit > 0 && limit <= MAX_PAGE_SIZE, "Ukuran halaman tidak valid");
        require(cursor <= length, "Cursor tidak valid");
        uint256 count = length - cursor < limit ? length - cursor : limit;
        addrs = new address[](count);
        rs = new Role[](count);
        for (uint256 i = 0; i < count; i++) {
            addrs[i] = members[cursor + i];
            rs[i] = roles[addrs[i]];
        }
        nextCursor = cursor + count;
    }

    function hasText(string calldata value) private pure returns (bool) {
        bytes calldata chars = bytes(value);
        uint256 length = chars.length;
        for (uint256 i = 0; i < length; i++) {
            uint8 char = uint8(chars[i]);
            if (char != 32 && (char < 9 || char > 13)) return true;
        }
        return false;
    }

    function validateAsset(
        string calldata name,
        string calldata category,
        string calldata location,
        string calldata condition,
        address custodian
    ) private pure {
        require(bytes(name).length <= MAX_TEXT_BYTES && bytes(category).length <= MAX_TEXT_BYTES &&
            bytes(location).length <= MAX_TEXT_BYTES && bytes(condition).length <= MAX_TEXT_BYTES, "Teks terlalu panjang");
        require(hasText(name), "Nama wajib diisi");
        require(hasText(category), "Kategori wajib diisi");
        require(hasText(location), "Lokasi wajib diisi");
        require(hasText(condition), "Kondisi wajib diisi");
        require(custodian != address(0), "Alamat penanggung jawab tidak valid");
    }

    // ---------- Asset CRUD ----------
    /// CREATE (Editor+)
    function createAsset(
        string calldata name,
        string calldata category,
        string calldata location,
        string calldata condition,
        address custodian
    ) external atLeast(Role.Editor) returns (uint256 id) {
        validateAsset(name, category, location, condition, custodian);
        id = assets.length;
        assets.push(Asset(id, name, category, location, condition, custodian, msg.sender,
            uint64(block.timestamp), uint64(block.timestamp), true));
        emit AssetCreated(id, msg.sender);
    }

    /// READ (Viewer+)
    function getAsset(uint256 id) external view atLeast(Role.Viewer) returns (Asset memory) {
        require(id < assets.length, "Aset tidak ditemukan");
        return assets[id];
    }

    /// Returns active records from at most `limit` scanned IDs; deleted IDs advance the cursor.
    function getAssetsPage(uint256 cursor, uint256 limit) external view atLeast(Role.Viewer)
        returns (Asset[] memory out, uint256 nextCursor)
    {
        uint256 length = assets.length;
        require(limit > 0 && limit <= MAX_PAGE_SIZE, "Ukuran halaman tidak valid");
        require(cursor <= length, "Cursor tidak valid");
        uint256 count = length - cursor < limit ? length - cursor : limit;
        uint256 end = cursor + count;
        uint256 n = 0;
        for (uint256 i = cursor; i < end; i++) if (assets[i].active) n++;
        out = new Asset[](n);
        uint256 j = 0;
        for (uint256 i = cursor; i < end; i++) if (assets[i].active) out[j++] = assets[i];
        nextCursor = end;
    }

    function assetCount() external view atLeast(Role.Viewer) returns (uint256) { return assets.length; }

    /// UPDATE (Editor+)
    function updateAsset(
        uint256 id,
        string calldata name,
        string calldata category,
        string calldata location,
        string calldata condition,
        address custodian
    ) external atLeast(Role.Editor) {
        require(id < assets.length && assets[id].active, "Aset tidak ditemukan");
        validateAsset(name, category, location, condition, custodian);
        Asset storage a = assets[id];
        a.name = name; a.category = category; a.location = location;
        a.condition = condition; a.custodian = custodian;
        a.updatedAt = uint64(block.timestamp);
        emit AssetUpdated(id, msg.sender);
    }

    /// DELETE - soft delete (Manager+). Data tetap ada di riwayat blockchain.
    function deleteAsset(uint256 id) external atLeast(Role.Manager) {
        require(id < assets.length && assets[id].active, "Aset tidak ditemukan");
        assets[id].active = false;
        assets[id].updatedAt = uint64(block.timestamp);
        emit AssetDeleted(id, msg.sender);
    }
}
