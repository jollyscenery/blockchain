// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AssetRegistry - on-chain asset logging dengan role-based access control
/// Role: Admin (kelola role), Manager (tambah/ubah/hapus aset), Editor (tambah/ubah aset), Viewer (hanya baca)
contract AssetRegistry {
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
        require(account != msg.sender, "Tidak bisa mencabut role sendiri");
        _setRole(account, Role.None);
    }

    function _setRole(address account, Role role) internal {
        if (!isMember[account]) { isMember[account] = true; members.push(account); }
        roles[account] = role;
        emit RoleChanged(account, role, msg.sender);
    }

    function getRole(address account) external view returns (Role) { return roles[account]; }

    function getMembers() external view atLeast(Role.Admin) returns (address[] memory addrs, Role[] memory rs) {
        addrs = members;
        rs = new Role[](members.length);
        for (uint256 i = 0; i < members.length; i++) rs[i] = roles[members[i]];
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
        require(bytes(name).length > 0, "Nama wajib diisi");
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

    /// READ semua aset aktif (Viewer+)
    function getAllAssets() external view atLeast(Role.Viewer) returns (Asset[] memory) {
        uint256 n;
        for (uint256 i = 0; i < assets.length; i++) if (assets[i].active) n++;
        Asset[] memory out = new Asset[](n);
        uint256 j;
        for (uint256 i = 0; i < assets.length; i++) if (assets[i].active) out[j++] = assets[i];
        return out;
    }

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
        require(bytes(name).length > 0, "Nama wajib diisi");
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
