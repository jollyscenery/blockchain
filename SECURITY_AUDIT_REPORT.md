# Security Audit Report — Asset Logging dApp (Buku Aset)

Audit date 17 November 2026, Asia/Jakarta.

## 1. Executive Summary

The audit confirmed two application availability weaknesses. An Editor can grow the registry until its whole-list read exceeds a bounded RPC call budget. An unauthenticated caller with access to the backend can replace a victim's outstanding login nonce and make the victim retry authentication. Their assessed CVSS v4.0 scores are **5.3 Medium** and **2.0 Low** for the documented loopback backend deployment.

No confirmed Critical or High application vulnerability was identified. Tests upheld the four-role hierarchy, signature verification, one-time nonce consumption, JWT verification, profile ownership controls, SQL parameterization, React output escaping, and wallet-change session resets.

Dependency audits reported **45 development-package findings at the root and 2 in the frontend**, representing **24 unique upstream advisories**. All three production dependency audits returned zero reported vulnerabilities. Windows Vite development-server advisories warrant attention because the assessed development platform meets some of their prerequisites. Exploitability remains conditional on each advisory's call path and environment.

Read-only Sepolia verification matched the deployed executable bytecode to the reviewed source compiled with Solidity 0.8.24, Shanghai, optimizer disabled. Both application deployment files and the exported Remix ABI agree.

The application is suitable for a controlled, small-data academic demonstration with trusted role holders and restricted development-server access. General public exposure and larger registries require the remediation and further testing below.

Application source, dependency manifests, lockfiles, deployment configuration, and README were preserved throughout this audit. New deliverables consist of this report and audit evidence under `security-audit/`. The existing final submission ZIP was preserved.

## 2. Scope and Methodology

### Reviewed snapshot

The assessment used the latest working tree in `C:/blockchain - Asset Logging dApp/blockchain`, including pre-existing uncommitted implementation changes. The source manifest records SHA-256 hashes for 28 source, configuration, ABI, and documentation files in `security-audit/source-hashes-before.json`.

The reviewed components include the following files.

- `contracts/AssetRegistry.sol` and `test/AssetRegistry.test.js`.
- `backend/server.js`, `backend/server.test.js`, backend npm files, and environment example.
- `frontend/src/App.jsx`, `frontend/src/main.jsx`, stylesheet, HTML entry point, Vite configuration, frontend npm files, and environment example.
- `scripts/deploy.js`, `scripts/deployment-info.js`, `scripts/deployment-networks.js`, `scripts/sync-remix-deployment.js`, and `hardhat.config.js`.
- Root manifest, all three lockfiles, `.gitignore`, root environment example, `README.md`, `remix-abi.json`, and both `contract.json` files.

### Threat model and isolation

Attackers considered include wallets with None, Viewer, Editor, or Manager privileges, a malicious existing Editor, and a low-privileged local process able to contact the loopback backend. Browser-origin attacks were examined at the request and CORS layers. The backend explicitly binds `127.0.0.1` at `backend/server.js` line 205.

State-changing tests used an ephemeral in-process Hardhat network and an in-memory SQLite database. Browser tests loaded the existing React source with an audit-only Vite plugin supplying the local deployment in memory. Test signatures used disposable Hardhat signers. Personal SQLite records were excluded from the test fixtures.

Sepolia operations were restricted to network identification, bytecode reads, a block-number read, and a view call. The audit did not submit Sepolia transactions.

### Standards and tooling

Methodology used targeted source review, control-flow tracing, executable PoCs, existing regression tests, Slither 0.11.6, npm advisory reports, primary GitHub security advisories, and secret-pattern inspection. The tooling ran on Windows with Node.js 24.15.0, npm 11.12.1, and Python 3.13.

Access-control and gas-resilience review used SCSVS-AUTH, SCSVS-BLOCK-1, SCSTG-TEST-0004, and SCSTG-TEST-0008 as testing references. This was a targeted assessment against their relevant controls. [SCSVS](https://scs.owasp.org/SCSVS/), [access-control test](https://scs.owasp.org/SCSTG/tests/SCSVS-AUTH/SCSTG-TEST-0004/), [loop/gas test](https://scs.owasp.org/SCSTG/tests/SCSVS-BLOCK/SCSTG-TEST-0008/)

Web tests used WSTG authentication, JWT, SQL injection, and stored-XSS guidance. [WSTG authentication](https://wstg.owasp.org/v4.2/4-Web_Application_Security_Testing/04-Authentication_Testing/03-Testing_for_Weak_Lock_Out_Mechanism/), [JWT testing](https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/06-Session_Management/10-JSON_Web_Tokens/), [SQL injection](https://wstg.owasp.org/v4.2/4-Web_Application_Security_Testing/07-Input_Validation_Testing/05-Testing_for_SQL_Injection/), [stored XSS](https://wstg.owasp.org/stable/4-Web_Application_Security_Testing/07-Input_Validation_Testing/02-Testing_for_Stored_Cross_Site_Scripting/)

CVSS-B scores were calculated with `cvss` 3.6 and independently checked against FIRST's official JavaScript calculator. Metric decisions are explained with each finding. Threat and Environmental metrics were left undefined. [FIRST specification](https://www.first.org/cvss/v4.0/specification-document), [FIRST calculator source](https://github.com/FIRSTdotorg/cvss-v4-calculator)

## 3. Security Findings Summary

| ID | Vulnerability | Component | Severity | CWE | Status |
|---|---|---|---|---|---|
| AUD-01 | Unbounded whole-registry reads permit gas-budget denial of the asset dashboard | AssetRegistry and asset list UI | Medium, CVSS 5.3 | CWE-770 | Confirmed in an isolated local reproduction |
| AUD-02 | Unauthenticated replacement of a pending login challenge | Express authentication | Low, CVSS 2.0 for loopback deployment | CWE-799 | Confirmed in an isolated local reproduction |

Dependency advisories are assessed individually in section 5. Unconfirmed availability, session, and configuration risks appear in section 7.

## 4. Detailed Findings

### AUD-01 — Unbounded whole-registry reads permit gas-budget denial of the asset dashboard

| Field | Assessment |
|---|---|
| Severity | Medium |
| CVSS v4.0 | 5.3 |
| Vector | `CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N` |
| Affected source | `contracts/AssetRegistry.sol` lines 95–108 and 117–123 |
| Affected caller | `frontend/src/App.jsx` lines 235–241 |
| CWE | CWE-770, allocation of resources without limits or throttling |
| Status | Confirmed gas-budget failure in local Hardhat. Live Sepolia exhaustion was excluded from testing. |

#### Relevant code

```solidity
// contracts/AssetRegistry.sol, lines 117–123
function getAllAssets() external view atLeast(Role.Viewer) returns (Asset[] memory) {
    uint256 n;
    for (uint256 i = 0; i < assets.length; i++) if (assets[i].active) n++;
    Asset[] memory out = new Asset[](n);
    uint256 j;
    for (uint256 i = 0; i < assets.length; i++) if (assets[i].active) out[j++] = assets[i];
    return out;
}
```

#### Explanation and preconditions

Editors and higher roles can append unlimited assets through `createAsset`. The list read scans the entire historical array twice and allocates/copies every active record, including dynamic strings. The React asset dashboard always requests that complete result. A malicious existing Editor can increase the resource requirement without obtaining deletion or role-management privileges.

Exploitation requires an Editor or higher role, transaction funding, and enough writes to exceed the reader's call or response budget. Large strings can increase copying costs. Soft deletion retains historical entries in the loops. This audit exercised ordinary short strings and a fixed 16,000,000-gas local call budget.

#### Reproducible PoC

Run `node security-audit/dynamic-tests.cjs` from the project root with the audit browser dependency available. Its `SC-02` test deploys a disposable registry, grants Editor and Viewer roles, appends assets as Editor, and measures the Viewer list read. It snapshots and reverts the local gas-test state.

The essential test operation is below. `registry`, `editor`, and `viewer` are isolated Hardhat fixtures initialized by the retained harness.

```javascript
for (let i = 0; i < 600; i++) {
  await registry.connect(editor).createAsset(
    "Gas-" + i, "IT", "L", "Baik", editor.address
  );
}
await registry.connect(viewer).getAllAssets({ gasLimit: 16000000n });
```

The complete retained harness also contains one active asset before this loop, producing the measured 601-record case.

#### Actual result and impact

| Active assets | Estimated list-read gas |
|---|---|
| 151 | 3,909,899 |
| 301 | 7,965,674 |
| 451 | 12,223,949 |
| 601 | 16,684,724 |

At 601 active assets, the list read with the 16,000,000 budget reverted. `getAsset(1)` still succeeded. Whole-list retrieval and the dashboard can therefore become unavailable while individual asset operations remain usable. The exact failure size depends on EVM target, string sizes, and RPC/provider limits. The selected budget is an audit condition and was not asserted to be PublicNode's current cap.

Evidence is retained in `security-audit/dynamic-results.json` and `security-audit/dynamic-tests.txt`.

#### CVSS decisions

| Metric | Reason |
|---|---|
| AV:N | Registry writes can be submitted through network-accessible Ethereum RPC. |
| AC:L | Repeated permitted writes require no protection bypass. |
| AT:N | The attacker can create the required registry growth. |
| PR:L | Editor membership is required. |
| UI:N | Other users need take no attack-specific action. |
| VC:N, VI:N | No confidentiality loss or unauthorized record mutation was established. |
| VA:L | Aggregate reading fails while individual operations remain usable. |
| SC:N, SI:N, SA:N | No subsequent-system compromise was established. |

#### Recommended fix

Introduce a bounded paginated asset read and use it from the dashboard. Bound response sizes and consider defensible maximum text lengths. Keep historical access available. Pagination over a bounded range of historical IDs can preserve soft-delete history while limiting each call's work. Merely caching array lengths leaves the growth behavior intact.

A Solidity change would require a separately approved deployment plan because the reviewed deployment is immutable. This report proposes the remediation for review.

The mapping reflects unbounded allocation and copying in a gas-limited environment. [CWE-770](https://cwe.mitre.org/data/definitions/770.html), [SCSVS-BLOCK-1](https://scs.owasp.org/SCSVS/controls/SCSVS-BLOCK-1/), [SCSTG-TEST-0008](https://scs.owasp.org/SCSTG/tests/SCSVS-BLOCK/SCSTG-TEST-0008/)

### AUD-02 — Unauthenticated replacement of a pending login challenge

| Field | Assessment |
|---|---|
| Severity | Low for the documented loopback service |
| CVSS v4.0 | 2.0 |
| Vector | `CVSS:4.0/AV:L/AC:L/AT:P/PR:L/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N` |
| Affected source | `backend/server.js` lines 44, 68–73, and 79–89 |
| Deployment boundary | `backend/server.js` line 205 binds the service to loopback |
| CWE | CWE-799, improper control of interaction frequency |
| Status | Confirmed login denial from a second unauthenticated request |

#### Relevant code

```javascript
// backend/server.js, lines 68–73
app.get("/api/auth/nonce/:address", (req, res) => {
  const address = walletAddress(req.params.address);
  const nonce = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT OR REPLACE INTO nonces (address, nonce, expires) VALUES (?, ?, ?)")
    .run(address, nonce, Date.now() + NONCE_TTL);
  res.set("Cache-Control", "no-store").json({ message: loginMessage(address, nonce), deployment });
});
```

#### Explanation and preconditions

The nonce table has one row per wallet. Any caller can replace that row without wallet proof. If replacement occurs after a legitimate wallet receives its challenge and before login verification, the signature is checked against a different nonce and fails. Repeated replacement can disrupt that wallet's login attempts.

The attacker needs backend reachability, a target's public wallet address, and timing that overlaps a pending login. For the current loopback service, the validated path assumes a low-privileged local account/process. Browser cross-origin delivery is a separate deployment/browser-policy question.

The test also sent an untrusted Origin header. The response advertised the configured legitimate origin, so browser response reading would remain constrained by CORS. The replacement side effect occurred before any browser decision about reading that response.

#### Reproducible PoC

The `API-06` test in `security-audit/dynamic-tests.cjs` executes the following sequence in memory.

1. Request a challenge for the Viewer fixture and sign it with that Viewer.
2. Make a second unauthenticated `GET /api/auth/nonce/<viewer>`.
3. Submit the original valid signature to `POST /api/auth/login`.
4. Obtain a fresh challenge and complete login to confirm recovery.

#### Actual result and impact

The replacement request returned **200**. Submission of the original wallet-signed challenge returned **401**. A fresh challenge allowed login. The attacker supplied no signature during replacement. Signature verification continued to gate JWT issuance.

The bounded `API-07` test accepted 100 challenge requests for different addresses without throttling. It also recorded 100 expired rows remaining after subsequent challenge activity. Disk exhaustion was excluded from testing and is discussed as a further risk.

#### CVSS decisions

| Metric | Reason |
|---|---|
| AV:L | The validated attack uses local process access to the loopback-only service. |
| AC:L | One ordinary unauthenticated challenge request performs replacement. |
| AT:P | The request must overlap a victim's pending challenge. |
| PR:L | The scored local-process path assumes a non-administrative local account. No application role or wallet proof is required. |
| UI:N | No malicious approval or lure is needed. Ordinary login timing is captured by AT:P. |
| VC:N, VI:N | No data disclosure or unauthorized profile/asset mutation was established. |
| VA:L | A wallet's login attempt fails and can recover with a fresh challenge. |
| SC:N, SI:N, SA:N | No subsequent-system impact was established. |

If the same API were exposed publicly without compensating controls, the conditional vector would be `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N`, scoring **6.3 Medium**. That is a deployment scenario for planning.

#### Recommended fix

Give each outstanding challenge a unique identifier and verify/consume that exact challenge without allowing an unrelated request to overwrite it. Permit a small bounded number of short-lived outstanding challenges. Apply per-address and per-client issuance limits, expire and delete old rows, and cap challenge storage. Avoid a design that lets an attacker reserve a wallet's sole challenge slot indefinitely.

CORS alone leaves unauthenticated endpoint side effects available to callers that can reach the API. [CWE-799](https://cwe.mitre.org/data/definitions/799.html), [WSTG authentication request-control guidance](https://wstg.owasp.org/v4.2/4-Web_Application_Security_Testing/04-Authentication_Testing/03-Testing_for_Weak_Lock_Out_Mechanism/)

## 5. Dependency Audit Results

### Counts and interpretation

All six requested audits ran against the current lockfiles. Exit 1 from the full root/frontend audits indicates reported advisories.

| Command executed | Critical | High | Moderate | Low | Total | Exit |
|---|---|---|---|---|---|---|
| `npm.cmd audit --json --prefix .` | 0 | 8 | 11 | 26 | 45 | 1 |
| `npm.cmd audit --json --prefix backend` | 0 | 0 | 0 | 0 | 0 | 0 |
| `npm.cmd audit --json --prefix frontend` | 0 | 1 | 1 | 0 | 2 | 1 |
| `npm.cmd audit --json --prefix . --omit=dev` | 0 | 0 | 0 | 0 | 0 | 0 |
| `npm.cmd audit --json --prefix backend --omit=dev` | 0 | 0 | 0 | 0 | 0 | 0 |
| `npm.cmd audit --json --prefix frontend --omit=dev` | 0 | 0 | 0 | 0 | 0 | 0 |

The 47 package findings include inherited dependency exposure. Their direct advisory records resolve to 24 unique GHSA IDs. No known vulnerabilities were reported in the audited production sets. Source-code findings remain relevant independently of those counts.

The root manifest places Hardhat and toolbox in devDependencies. ethers v5 packages listed there are inherited legacy tooling. The backend and frontend use independently resolved ethers v6. Browser signing occurs through MetaMask.

Raw reports are `security-audit/root-full.json`, `backend-full.json`, `frontend-full.json`, and their `*-production.json` counterparts. `advisory-details.json` contains the fetched primary records. `dependency-details.json` records installed vulnerable versions and npm's proposed owner-level fixes.

npm proposes some major migrations, including Hardhat 3.22.0 and Vite 8.3.8. Their compatibility with the assignment stack requires separate evaluation. No dependency update or lockfile change was applied.

### Development package inventory

All 47 rows below are development-dependency findings. npm counts inherited vulnerable packages along with the underlying advisory packages. Each row records its direct advisory IDs or the packages through which it inherits a finding. The following advisory inventory resolves all 24 unique GHSA records.

| Scope | Package | Installed version(s) | Relationship | npm severity | Direct advisory or inherited dependency |
|---|---|---|---|---|---|
| root | @ethersproject/abi | 5.8.0 | Transitive | low | @ethersproject/hash |
| root | @ethersproject/abstract-provider | 5.8.0 | Transitive | low | @ethersproject/transactions |
| root | @ethersproject/abstract-signer | 5.8.0 | Transitive | low | @ethersproject/abstract-provider |
| root | @ethersproject/contracts | 5.8.0 | Transitive | low | @ethersproject/abi, @ethersproject/abstract-provider, @ethersproject/abstract-signer, @ethersproject/transactions |
| root | @ethersproject/hash | 5.8.0 | Transitive | low | @ethersproject/abstract-signer |
| root | @ethersproject/hdnode | 5.8.0 | Transitive | low | @ethersproject/abstract-signer, @ethersproject/signing-key, @ethersproject/transactions, @ethersproject/wordlists |
| root | @ethersproject/json-wallets | 5.8.0 | Transitive | low | @ethersproject/abstract-signer, @ethersproject/hdnode, @ethersproject/transactions |
| root | @ethersproject/providers | 5.8.0 | Transitive | moderate | @ethersproject/abstract-provider, @ethersproject/abstract-signer, @ethersproject/hash, @ethersproject/transactions, ws |
| root | @ethersproject/signing-key | 5.8.0 | Transitive | low | elliptic |
| root | @ethersproject/transactions | 5.8.0 | Transitive | low | @ethersproject/signing-key |
| root | @ethersproject/wallet | 5.8.0 | Transitive | low | @ethersproject/abstract-provider, @ethersproject/abstract-signer, @ethersproject/hash, @ethersproject/hdnode, @ethersproject/json-wallets, @ethersproject/signing-key, @ethersproject/transactions, @ethersproject/wordlists |
| root | @ethersproject/wordlists | 5.8.0 | Transitive | low | @ethersproject/hash |
| root | @nomicfoundation/hardhat-chai-matchers | 2.1.2 | Transitive | low | @nomicfoundation/hardhat-ethers, hardhat |
| root | @nomicfoundation/hardhat-ethers | 3.1.3 | Transitive | low | hardhat |
| root | @nomicfoundation/hardhat-ignition | 0.15.16 | Transitive | high | @nomicfoundation/hardhat-verify, @nomicfoundation/ignition-core, hardhat |
| root | @nomicfoundation/hardhat-ignition-ethers | 0.15.17 | Transitive | high | @nomicfoundation/hardhat-ethers, @nomicfoundation/hardhat-ignition, @nomicfoundation/ignition-core, hardhat |
| root | @nomicfoundation/hardhat-network-helpers | 1.1.2 | Transitive | low | ethereumjs-util, hardhat |
| root | @nomicfoundation/hardhat-toolbox | 5.0.0 | Direct | high | @nomicfoundation/hardhat-chai-matchers, @nomicfoundation/hardhat-ethers, @nomicfoundation/hardhat-ignition-ethers, @nomicfoundation/hardhat-network-helpers, @nomicfoundation/hardhat-verify, @typechain/hardhat, hardhat, hardhat-gas-reporter |
| root | @nomicfoundation/hardhat-verify | 2.1.4 | Transitive | low | @ethersproject/abi, hardhat |
| root | @nomicfoundation/ignition-core | 0.15.15 | Transitive | high | lodash |
| root | @sentry/node | 5.30.0 | Transitive | low | cookie |
| root | @typechain/hardhat | 9.1.0 | Transitive | low | hardhat |
| root | bn.js | 4.11.6 | Transitive | moderate | GHSA-378v-28hj-76wf |
| root | cookie | 0.4.2 | Transitive | low | GHSA-pxg6-pf52-xh8x |
| root | diff | 7.0.0 | Transitive | low | GHSA-73rr-hh4g-fpgx |
| root | elliptic | 6.6.1 | Transitive | low | GHSA-848j-6mx2-7j84 |
| root | eth-gas-reporter | 0.2.27 | Transitive | moderate | mocha |
| root | ethereum-cryptography | 0.1.3 | Transitive | low | secp256k1 |
| root | ethereumjs-util | 7.1.5 | Transitive | low | ethereum-cryptography |
| root | ethers | 5.8.0 | Transitive | moderate | @ethersproject/abi, @ethersproject/abstract-provider, @ethersproject/abstract-signer, @ethersproject/contracts, @ethersproject/hash, @ethersproject/hdnode, @ethersproject/json-wallets, @ethersproject/providers, @ethersproject/signing-key, @ethersproject/transactions, @ethersproject/wallet, @ethersproject/wordlists |
| root | ethjs-unit | 0.1.6 | Transitive | moderate | bn.js, number-to-bn |
| root | glob | 10.5.0 | Transitive | moderate | GHSA-3g3m-2fjr-6pw4, minimatch |
| root | hardhat | 2.29.2 | Direct | low | @ethersproject/abi, @sentry/node, solc |
| root | hardhat-gas-reporter | 1.0.10 | Transitive | low | hardhat |
| root | lodash | 4.17.21 | Transitive | high | GHSA-r5fr-rjxr-66jc, GHSA-xxjr-mmjv-4gpg |
| root | minimatch | 9.0.9 | Transitive | moderate | GHSA-g3hv-75wg-m249 |
| root | mocha | 10.8.2, 11.8.0 | Transitive | moderate | diff, glob, minimatch, serialize-javascript |
| root | number-to-bn | 1.7.0 | Transitive | moderate | bn.js |
| root | secp256k1 | 4.0.5 | Transitive | low | elliptic |
| root | serialize-javascript | 6.0.2 | Transitive | high | GHSA-5c6j-r48x-rmvq, GHSA-qj8w-gfj5-8c6v, GHSA-m5mm-p8h7-m29v |
| root | solc | 0.8.26 | Transitive | low | tmp |
| root | solidity-coverage | 0.8.17 | Transitive | moderate | hardhat, mocha, web3-utils |
| root | tmp | 0.0.33 | Transitive | high | GHSA-52f5-9888-hmc6, GHSA-ph9p-34f9-6g65 |
| root | web3-utils | 1.10.4 | Transitive | moderate | ethjs-unit, number-to-bn |
| root | ws | 8.18.0 | Transitive | high | GHSA-58qx-3vcg-4xpx, GHSA-96hv-2xvq-fx4p |
| frontend | esbuild | 0.21.5 | Transitive | moderate | GHSA-67mh-4wv8-2f99 |
| frontend | vite | 5.4.21 | Direct | high | GHSA-4w7w-66w2-5vf9, GHSA-v6wh-96g9-6wx3, GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm, GHSA-9jrq-w75r-8gcw, GHSA-rq7h-c2jc-7f22, GHSA-fx2h-pf6j-xcff, esbuild |

### Individual advisory analysis

Reachability assessments concern the inspected call sites, Windows environment and documented loopback configuration. Dependency payloads were not assumed exploitable solely from the presence of a vulnerable version.

#### GHSA-378v-28hj-76wf

bn.js affected by an infinite loop.

Upstream severity **medium**. CVE **CVE-2026-2739**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:bn.js | 4.11.6 | <4.12.3 | Development, transitive |

maskn(0) can hang bn.js. No reviewed request reaches that API. Patch 4.x to >=4.12.3 through the owning tool. Low patch compatibility risk.

The upstream fixed-line mapping is bn.js < 4.12.3 -> 4.12.3. bn.js >= 5.0.0, < 5.2.3 -> 5.2.3.

[Upstream advisory](https://github.com/advisories/GHSA-378v-28hj-76wf)

#### GHSA-3g3m-2fjr-6pw4

Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal.

Upstream severity **medium**. CVE **CVE-2026-118773**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:glob | 10.5.0 | >=9.0.0 <=14.0.1 | Development, transitive |

Aborted glob traversal can continue filesystem work. No reviewed HTTP request controls a tooling walk. Owner update is preferable to overriding glob 10.x with fixed 14.0.2, which crosses majors.

The upstream fixed-line mapping is glob >= 9.0.0, <= 14.0.1 -> 14.0.2.

[Upstream advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)

#### GHSA-4w7w-66w2-5vf9

Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling.

Upstream severity **medium**. CVE **CVE-2026-39365**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| frontend:vite | 5.4.21 | <=6.4.1 | Development, direct |

Vite dev middleware is present. Exploit needs a reachable server and a predictable sensitive valid .map file. Not reproduced. A patched Vite 6.4.4+ line covers the combined Vite list. Migration from Vite 5 needs build and plugin checks.

The upstream fixed-line mapping is vite >= 8.0.0, <= 8.0.4 -> 8.0.5. vite >= 7.0.0, <= 7.3.1 -> 7.3.2. vite <= 6.4.1 -> 6.4.2.

[Upstream advisory](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)

#### GHSA-52f5-9888-hmc6

tmp allows arbitrary temporary file / directory write via symbolic link `dir` parameter.

Upstream severity **low**. CVE **CVE-2025-54798**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:tmp | 0.0.33 | <=0.2.3 | Development, transitive |

Requires a symlink-backed tmp dir option. No reviewed API controls tmp options. Resolve tmp >=0.2.6 for both advisories through the owner. Changing from 0.0.33 requires compiler/temp-file regression tests.

The upstream fixed-line mapping is tmp <= 0.2.3 -> 0.2.4.

[Upstream advisory](https://github.com/advisories/GHSA-52f5-9888-hmc6)

#### GHSA-587h-7wmj-h5pm

launch-editor: `fs.existsSync()` existence check can be bypassed on Windows.

Upstream severity **high**. CVE **CVE-2026-112942**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| frontend:vite | 5.4.21 | <=6.4.3 | Development, direct |

Windows and bundled Vite editor middleware are present. Crafted Windows path handling can combine with command argument issues. No shell payload was executed. Resolve the bundled fix through Vite >=6.4.4 on 6.x. Major migration needs tests.

The upstream fixed-line mapping is vite >= 8.3.0, <= 8.3.2 -> 8.3.3. vite >= 8.2.0, <= 8.2.3 -> 8.2.4. vite >= 8.0.0, <= 8.1.5 -> 8.1.6. vite >= 7.0.0, <= 7.3.6 -> 7.3.7. vite <= 6.4.3 -> 6.4.4.

[Upstream advisory](https://github.com/advisories/GHSA-587h-7wmj-h5pm)

#### GHSA-58qx-3vcg-4xpx

ws: Uninitialized memory disclosure.

Upstream severity **medium**. CVE **CVE-2026-45736**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:ws | 8.18.0 | >=8.0.0 <8.20.1 | Development, transitive |

Requires ws.close with an attacker-influenced TypedArray reason. No reviewed caller supplies it. Resolve ws >=8.21.0 on 8.x for both ws advisories through the owner. Same-major update has lower compatibility risk.

The upstream fixed-line mapping is ws >= 8.0.0, < 8.20.1 -> 8.20.1.

[Upstream advisory](https://github.com/advisories/GHSA-58qx-3vcg-4xpx)

#### GHSA-5c6j-r48x-rmvq

Serialize JavaScript is Vulnerable to RCE via RegExp.flags and Date.prototype.toISOString().

Upstream severity **high**. CVE **Unassigned in the fetched record**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:serialize-javascript | 6.0.2 | <=7.0.2 | Development, transitive |

Requires a crafted RegExp or Date reaching serialize() and evaluation of its output. Mocha imports the package for parallel options, which remote profile JSON cannot control as executable objects. Resolve >=7.1.3 through the owner. Cross-major override needs worker tests.

The upstream fixed-line mapping is serialize-javascript <= 7.0.2 -> 7.0.3.

[Upstream advisory](https://github.com/advisories/GHSA-5c6j-r48x-rmvq)

#### GHSA-67mh-4wv8-2f99

esbuild enables any website to send any requests to the development server and read the response.

Upstream severity **medium**. CVE **Unassigned in the fetched record**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| frontend:esbuild | 0.21.5 | <=0.24.2 | Development, transitive |

Affected operation is esbuild's own serve API. The project uses Vite HTTP serving and esbuild transformations. No esbuild.serve path was established. Resolve esbuild >=0.25.0 through a supported Vite update. A forced 0.x override risks integration breakage.

The upstream fixed-line mapping is esbuild <= 0.24.2 -> 0.25.0.

[Upstream advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99)

#### GHSA-698v-4r3x-3vcv

launch-editor: escapeCmdArgs() omits % escaping on Windows.

Upstream severity **medium**. CVE **CVE-2026-112943**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| frontend:vite | 5.4.21 | <=6.4.3 | Development, direct |

Windows Vite editor middleware is relevant. Additional prerequisites include a crafted path and controlled environment or NTFS-stream conditions. Not exercised. Use patched Vite bundled middleware, >=6.4.4 on 6.x. Standalone launch-editor replacement may leave the bundle unchanged.

The upstream fixed-line mapping is vite >= 8.3.0, <= 8.3.2 -> 8.3.3. vite >= 8.2.0, <= 8.2.3 -> 8.2.4. vite >= 8.0.0, <= 8.1.5 -> 8.1.6. vite >= 7.0.0, <= 7.3.6 -> 7.3.7. vite <= 6.4.3 -> 6.4.4.

[Upstream advisory](https://github.com/advisories/GHSA-698v-4r3x-3vcv)

#### GHSA-73rr-hh4g-fpgx

jsdiff has a Denial of Service vulnerability in parsePatch and applyPatch.

Upstream severity **low**. CVE **CVE-2026-24001**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:diff | 7.0.0 | >=6.0.0 <8.0.3 | Development, transitive |

Requires untrusted parsePatch or string-form applyPatch input. Reviewed API routes and tests do not parse user patches. Resolve diff 8.0.3 via its owner or a supported patched branch. A 7.x-to-8.x override needs reporter tests.

The upstream fixed-line mapping is diff >= 6.0.0, < 8.0.3 -> 8.0.3. diff >= 5.0.0, < 5.2.2 -> 5.2.2. diff >= 4.0.0, < 4.0.4 -> 4.0.4. diff < 3.5.1 -> 3.5.1.

[Upstream advisory](https://github.com/advisories/GHSA-73rr-hh4g-fpgx)

#### GHSA-848j-6mx2-7j84

Elliptic Uses a Cryptographic Primitive with a Risky Implementation.

Upstream severity **low**. CVE **CVE-2025-14505**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:elliptic | 6.6.1 | <=6.6.1 | Development, transitive |

Concerns legacy deterministic ECDSA signing. MetaMask signs transactions and the backend uses ethers v6. No production signing path through root elliptic was identified. No upstream patch is listed. Migrate the owning tool on a separately tested branch, with high compatibility risk for Hardhat 3.

The upstream fixed-line mapping is elliptic <= 6.6.1 -> no fixed version listed.

[Upstream advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84)

#### GHSA-96hv-2xvq-fx4p

ws: Memory exhaustion DoS from tiny fragments and data chunks.

Upstream severity **high**. CVE **CVE-2026-48779**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:ws | 8.18.0 | >=8.0.0 <8.21.0 | Development, transitive |

Requires hostile WebSocket fragmentation against an affected receiver. An explicitly started Hardhat node has WebSocket RPC. No fragmentation test was run. Resolve ws >=8.21.0 on 8.x and constrain local-node access. Retest RPC compatibility.

The upstream fixed-line mapping is ws >= 1.1.0, < 5.2.5 -> 5.2.5. ws >= 6.0.0, < 6.2.4 -> 6.2.4. ws >= 7.0.0, < 7.5.11 -> 7.5.11. ws >= 8.0.0, < 8.21.0 -> 8.21.0.

[Upstream advisory](https://github.com/advisories/GHSA-96hv-2xvq-fx4p)

#### GHSA-9jrq-w75r-8gcw

Vite: Cross origin script execution through Vite custom middleware.

Upstream severity **low**. CVE **CVE-2026-112945**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| frontend:vite | 5.4.21 | <=6.4.3 | Development, direct |

Requires Vite custom middleware emitting user-influenced content with an unsuitable content type. vite.config.js only adds the React plugin. That prerequisite was not found. Use patched Vite >=6.4.4 on 6.x, with migration testing.

The upstream fixed-line mapping is vite >= 8.3.0, <= 8.3.2 -> 8.3.3. vite >= 8.2.0, <= 8.2.3 -> 8.2.4. vite >= 8.0.0, <= 8.1.5 -> 8.1.6. vite >= 7.0.0, <= 7.3.6 -> 7.3.7. vite <= 6.4.3 -> 6.4.4.

[Upstream advisory](https://github.com/advisories/GHSA-9jrq-w75r-8gcw)

#### GHSA-fx2h-pf6j-xcff

vite: `server.fs.deny` bypass on Windows alternate paths.

Upstream severity **medium**. CVE **CVE-2026-53571**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| frontend:vite | 5.4.21 | <=6.4.2 | Development, direct |

Windows alternate paths can bypass Vite fs.deny for sensitive files inside allowed roots on NTFS/eligible short-name volumes. Platform condition exists. No real environment file was requested. Use Vite >=6.4.4 on 6.x for the combined list. Major migration needs testing.

The upstream fixed-line mapping is vite >= 8.0.0, <= 8.0.15 -> 8.0.16. vite >= 7.0.0, <= 7.3.4 -> 7.3.5. vite <= 6.4.2 -> 6.4.3.

[Upstream advisory](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)

#### GHSA-g3hv-75wg-m249

minimatch has potential denial of service via globparts amplification.

Upstream severity **medium**. CVE **CVE-2026-118764**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:minimatch | 9.0.9 | >=7.0.0 <11.0.1 | Development, transitive |

Requires hostile patterns with optimizationLevel >=2. No reviewed API supplies these patterns to minimatch. Resolve >=11.0.1 through the owning tool. A forced 9.x-to-11.x override has major compatibility risk.

The upstream fixed-line mapping is minimatch >= 7.0.0, < 11.0.1 -> 11.0.1.

[Upstream advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)

#### GHSA-m5mm-p8h7-m29v

Serialize JavaScript: Cross-site scripting (XSS) via unescaped </script at the end of a serialized function body.

Upstream severity **low**. CVE **CVE-2026-115897**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:serialize-javascript | 6.0.2 | <7.1.3 | Development, transitive |

Requires attacker-controlled function source or spoofed toString and embedding serialized output in HTML. HTTP JSON does not carry such function objects into Mocha. Resolve serialize-javascript >=7.1.3 through the owner, with major-version worker tests.

The upstream fixed-line mapping is serialize-javascript < 7.1.3 -> 7.1.3.

[Upstream advisory](https://github.com/advisories/GHSA-m5mm-p8h7-m29v)

#### GHSA-ph9p-34f9-6g65

tmp has Path Traversal via unsanitized prefix/postfix that enables directory escape.

Upstream severity **high**. CVE **CVE-2026-44705**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:tmp | 0.0.33 | <0.2.6 | Development, transitive |

Requires untrusted tmp prefix/postfix/dir. No reviewed route passes user data there. Resolve tmp >=0.2.6 through the owning compiler/tool. The 0.x transition needs temporary-file regression tests.

The upstream fixed-line mapping is tmp < 0.2.6 -> 0.2.6.

[Upstream advisory](https://github.com/advisories/GHSA-ph9p-34f9-6g65)

#### GHSA-pxg6-pf52-xh8x

cookie accepts cookie name, path, and domain with out of bounds characters.

Upstream severity **low**. CVE **CVE-2024-47764**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:cookie | 0.4.2 | <0.7.0 | Development, transitive |

Requires untrusted cookie names/path/domain reaching the legacy root serializer. Backend uses bearer tokens and its independent dependency audit is clean. Resolve cookie >=0.7.0 through the owner and test the 0.x API transition.

The upstream fixed-line mapping is cookie < 0.7.0 -> 0.7.0.

[Upstream advisory](https://github.com/advisories/GHSA-pxg6-pf52-xh8x)

#### GHSA-qj8w-gfj5-8c6v

Serialize JavaScript has CPU Exhaustion Denial of Service via crafted array-like objects.

Upstream severity **medium**. CVE **CVE-2026-34043**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:serialize-javascript | 6.0.2 | >=5.0.0 <7.0.5 | Development, transitive |

Requires crafted array-like prototype objects reaching serialize-javascript. Profiles do not reach the development serializer. Resolve >=7.1.3 through the owner, with cross-major compatibility testing.

The upstream fixed-line mapping is serialize-javascript >= 5.0.0, < 7.0.5 -> 7.0.5.

[Upstream advisory](https://github.com/advisories/GHSA-qj8w-gfj5-8c6v)

#### GHSA-r5fr-rjxr-66jc

lodash vulnerable to Code Injection via `_.template` imports key names.

Upstream severity **high**. CVE **CVE-2026-4800**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:lodash | 4.17.21 | >=4.0.0 <=4.17.23 | Development, transitive |

Requires hostile _.template imports key names or an additional prototype-pollution prerequisite. No reviewed app call supplies them. Resolve lodash >=4.18.0 through the owner. Same-major update still needs tooling tests.

The upstream fixed-line mapping is lodash >= 4.0.0, <= 4.17.23 -> 4.18.0.

[Upstream advisory](https://github.com/advisories/GHSA-r5fr-rjxr-66jc)

#### GHSA-r825-w8mm-5pxw

launch-editor: Editor CLI flag misinterpretation causing arbitrary command execution for some editors.

Upstream severity **medium**. CVE **CVE-2026-112944**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| frontend:vite | 5.4.21 | <=6.4.3 | Development, direct |

Vite scenario requires WSL, a relevant editor and attacker-created +/- filesystem entries. Native Windows PowerShell was used and WSL prerequisite was absent. Resolve bundled middleware via Vite >=6.4.4 on 6.x, with editor/build checks.

The upstream fixed-line mapping is vite >= 8.3.0, <= 8.3.2 -> 8.3.3. vite >= 8.2.0, <= 8.2.3 -> 8.2.4. vite >= 8.0.0, <= 8.1.5 -> 8.1.6. vite >= 7.0.0, <= 7.3.6 -> 7.3.7. vite <= 6.4.3 -> 6.4.4.

[Upstream advisory](https://github.com/advisories/GHSA-r825-w8mm-5pxw)

#### GHSA-rq7h-c2jc-7f22

Vite: Files outside `server.fs.allow` could be served when project paths match system paths on non-Windows machine.

Upstream severity **medium**. CVE **CVE-2026-112946**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| frontend:vite | 5.4.21 | <=6.4.3 | Development, direct |

Requires a non-Windows server and imported path colliding with a host absolute path. Platform prerequisite is absent here and required import shape was not found. Upgrade Vite before testing matching deployments, with major migration checks.

The upstream fixed-line mapping is vite >= 8.3.0, <= 8.3.2 -> 8.3.3. vite >= 8.2.0, <= 8.2.3 -> 8.2.4. vite >= 8.0.0, <= 8.1.5 -> 8.1.6. vite >= 7.0.0, <= 7.3.6 -> 7.3.7. vite <= 6.4.3 -> 6.4.4.

[Upstream advisory](https://github.com/advisories/GHSA-rq7h-c2jc-7f22)

#### GHSA-v6wh-96g9-6wx3

launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows.

Upstream severity **medium**. CVE **CVE-2026-53632**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| frontend:vite | 5.4.21 | <=6.4.2 | Development, direct |

Windows and bundled /__open-in-editor are present. Exploitation additionally depends on request reachability and outbound NTLM/SMB. No UNC path or credential capture was attempted. Resolve bundled middleware via Vite >=6.4.4 on 6.x and review NTLM policy separately.

The upstream fixed-line mapping is vite >= 8.0.0, <= 8.0.15 -> 8.0.16. vite >= 7.0.0, <= 7.3.4 -> 7.3.5. vite <= 6.4.2 -> 6.4.3.

[Upstream advisory](https://github.com/advisories/GHSA-v6wh-96g9-6wx3)

#### GHSA-xxjr-mmjv-4gpg

Lodash has Prototype Pollution Vulnerability in `_.unset`, `_.omit`, and `_.pullAt` functions.

Upstream severity **medium**. CVE **CVE-2025-13465**.

| Affected package | Installed version(s) | Vulnerable range in npm audit | Relationship |
|---|---|---|---|
| root:lodash | 4.17.21 | >=4.0.0 <=4.17.22 | Development, transitive |

Requires hostile _.unset/_.omit/_.pullAt paths. No reviewed API reaches those tooling methods. Resolve lodash >=4.18.0 to cover both lodash advisories. Lower same-major compatibility risk, with regression tests.

The upstream fixed-line mapping is lodash >= 4.0.0, <= 4.17.22 -> 4.17.23.

[Upstream advisory](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg)


## 6. Security Tests Executed

### Regression and application tests

| Command or test group | Actual result |
|---|---|
| `npm.cmd test` | 11 contract tests passed. Evidence in `contract-tests.txt`. |
| `npm.cmd run test:backend` | 6 API/SQLite tests passed. Evidence in `backend-tests.txt`. |
| `node security-audit/dynamic-tests.cjs` | 10 additional test groups passed their assertions. API-06 and SC-02 deliberately reproduce the confirmed weaknesses. |
| `npm.cmd run build --prefix frontend -- --outDir ../security-audit/frontend-build` | Vite 5.4.21 built successfully. Output was directed into the audit directory. |
| `node security-audit/verify-sepolia.cjs` | Read-only bytecode/source/ABI/configuration checks passed. |
| `node security-audit/cvss-check.cjs` | Both assessed vectors and the conditional deployment vector matched FIRST's calculator. |
| `node security-audit/startup-error-tests.cjs` | Three test groups passed. Empty and short JWT secrets caused exit 1. Simulated RPC failure returned 503 without injected upstream details. Evidence in `startup-error-tests.json`. |

The local dynamic harness is retained with its assertions and fixture setup. It imports existing application code and stores no production database data. Its browser test uses Playwright Core from `node_modules/.browser-qa/node_modules/playwright-core` and the installed Chrome binary. That audit-only dependency existed from prior verification. Reproduction on another computer requires Playwright Core and adjustment of the Chrome executable path.

The initial Windows sandbox denied loopback connections in prior workflow setup. This audit's API/browser executions used the approved local-process capability. All new attack state remained in disposable local fixtures.

### Control validation matrix

| Area | Inspection and actual evidence | Conclusion |
|---|---|---|
| Role hierarchy | Enum is None=0, Viewer=1, Editor=2, Manager=3, Admin=4. Modifier comparisons are hierarchical. | Matches the four-role specification. |
| Contract access control | Local tests denied Viewer/None create/update/delete, Editor delete, and non-Admin setRole/revokeRole. | No tested permission bypass. |
| Revocation | Local contract revoked-write test and existing API downgrade/revocation test passed. | Current role is enforced independently of UI. |
| Asset state | IDs append from array length. Create/update/delete events and timestamps passed existing tests. Deleted records stay readable individually and reject update/delete. | No tested resurrection, duplicate-ID, or unauthorized state transition. |
| Reentrancy | Source contains no external contract calls, ether transfers, delegatecalls, or callbacks. | No applicable reentrancy path identified. |
| Arithmetic | Solidity 0.8.24 checked operations, bounds requirements, and enum decoding constrain tested inputs. | No exploitable overflow/underflow identified. |
| Custodian/ownership | Custodian must be nonzero. Editors intentionally modify any active asset under the agreed model. | Global editing is authorized behavior. |
| Signatures | Invalid signer, malformed signature, chain-altered message, expired challenge, and consumed challenge tests passed. | No tested impersonation or replay bypass. |
| Concurrent replay | Existing test submitted one signed proof three times concurrently and obtained one 200 and two 401 responses. | SQL conditional consumption worked. |
| JWT | HS256 allowlist, issuer, audience, two-hour expiry, malformed/tampered/unsigned/wrong-algorithm tokens tested. | No tested token-validation bypass. |
| Backend roles and IDOR | Seven new forbidden directory/profile requests returned 403. Body address and role fields did not change the authenticated owner. | Viewer/Editor/Manager could not alter Admin profile. |
| SQL injection | Quote/SQL statements persisted as literal strings. The users table and Admin profile remained intact. | No tested SQL injection. |
| Request parsing | Oversized JSON returned 413, malformed JSON 400, and object-valued profile field 400. | Input checks handled tested malformed inputs. |
| CORS | Untrusted-origin response retained the legitimate allowed origin. Nonce mutation still occurred. | Response-read restriction works, with AUD-02 side effect. |
| Error responses | Simulated upstream failure returned a generic 503. JWT-secret failure occurred before service startup. | Tested failure paths were handled. |
| XSS | Stored img/onerror profile input and svg/onload asset input rendered as text. No injected img/svg nodes or script markers appeared. | No tested stored-XSS execution. |
| JWT storage | Browser localStorage and sessionStorage stayed empty after login. Session token lives in React state. | No persistent web-storage token identified. |
| Wallet switching | Active-account switch ended the session. A signature completed after account switching could not revive the old session. Chain change and disconnect also reset it. | No tested account/session substitution. |
| Network selection | Frontend checks chain ID before requesting a signature. Backend validates RPC chain and code hash at startup. | Configuration-bound checks are present. |
| UI role gates | Viewer write controls, Editor delete, and Manager role tab were absent. Contract/API tests independently exercised the operations. | Tested UI permissions match enforced permissions. |

The browser audit used a controlled EIP-1193 provider. The user separately reported successful manual MetaMask, on-chain CRUD, off-chain CRUD, and Remix demonstrations. This audit attributes those demonstrations to the user.

### Slither execution and manual triage

Slither was initially unavailable. It was installed with crytic-compile 0.4.2 into an isolated virtual environment. Its first invocation attempted to create `.solc-select` under the user profile and encountered the workspace permission boundary. Setting `VIRTUAL_ENV` to the audit environment kept tool state inside that environment.

The successful command consumed existing Hardhat build-info without recompiling or cleaning application artifacts.

```powershell
$env:VIRTUAL_ENV = (Resolve-Path -LiteralPath 'security-audit/tools').Path
security-audit/tools/Scripts/slither.exe . --ignore-compile --compile-force-framework hardhat --json security-audit/slither.json --disable-color
```

Slither 0.11.6 analyzed **1 contract with 102 detectors** and produced **8 results**. Its JSON records `success: true`. The CLI returned -1 on Windows because detector results were present.

| Detector | Count | Locations | Manual determination |
|---|---|---|---|
| uninitialized-local | 2 | Contract lines 118 and 121 | False positives for exploitable uninitialized values. Both uint256 counters receive Solidity's defined zero default. Empty/nonempty listings passed dynamic tests. |
| timestamp | 3 | Contract lines 112, 135, and 146 | False positives for dangerous timestamp-based decisions. The flagged conditions validate ID bounds and active status. Actual timestamps are stored as audit metadata. |
| cache-array-length | 3 | Contract lines 68, 119, and 122 | Informational optimization suggestions. Caching can reduce per-iteration gas and leaves aggregate growth addressed by AUD-01. |

Manual source tracing upheld these classifications. Numeric defaults are defined by Solidity. [Solidity 0.8.24 defaults](https://docs.soliditylang.org/en/v0.8.24/control-structures.html#default-value), [Slither detector reference](https://github.com/crytic/slither/wiki/Detector-Documentation)

### Deployment and secrets verification

| Check | Result |
|---|---|
| Sepolia address | `0xda0349D26Fb38dfC3Cf416feB0a9670C5cb6ad1C` |
| Chain ID | 11155111 |
| Read-only observation block | 12,155,550 |
| Deployed runtime size | 13,387 bytes |
| Compiler comparison | Solidity 0.8.24+commit.e11b9ed9, Shanghai, optimizer disabled |
| Executable bytecode | Matched reviewed source after removing compiler metadata trailer |
| Deployment hash | `0x06147f24c4736661e1c286d2476bdc2b1efd800061d3b4bc8e2077fe4aa99b70` matched RPC runtime |
| ABI | 14 exported ABI entries matched the compiled interface |
| Frontend/backend | Matching configuration objects and ABI |
| RPC operations | eth_chainId, eth_getCode, eth_blockNumber, eth_call |
| Sepolia state-changing operations | 0 |
| Source and history scan | 28 current files and 20 unique file/blob pairs across 2 reachable commits, with zero recognized credential-pattern hits |
| Environment ignores | Root, backend, and frontend .env paths are ignored |
| JWT secret checks | Existing local secret met the minimum length and differed from the known fixture/example strings. Its value was omitted from evidence. |
| Personal SQLite data | Excluded from audit fixtures and evidence |

The exact contract source SHA-256 is `565faa54fbe3b363f79bd6fd160438743f39c7b1ecb041346917bdcc0d2174df`. The verification script asserted equality between Hardhat compiler-input source and the reviewed file before comparing runtime bytecode. This ties deployment validation to the source.

Both example RPC-secret values are blank and the default Sepolia endpoint is HTTPS. The backend checks chain ID and runtime hash before opening the service. An override can currently use HTTP, which requires deployment judgment.

The secrets scan examined source and reachable Git history using recognizable key/token/provider-credential patterns. It also checked environment ignore rules. Arbitrary encodings and unknown secret formats remain outside that scan's guarantee.

## 7. Potential Risks

| ID | Observation | Evidence and unresolved question |
|---|---|---|
| RISK-01 | Challenge-table growth | API-07 retained 100 additional expired rows after subsequent activity. No garbage collection, quota, or issuance throttle was found. Eventual disk exhaustion and its effect on other SQLite writes were excluded from testing. |
| RISK-02 | RPC and API resource consumption | Each authorized protected request reads the chain, with synchronous SQLite access and no explicit concurrency/rate budget. Load-induced service failure was not measured. RPC outage produced the expected generic 503. |
| RISK-03 | Stateless JWT lifetime | Logout/account change clears React state. A previously copied JWT remains a bearer credential until expiry while the wallet retains a role. The backend rechecks current membership. Token theft and same-origin script compromise were not demonstrated. |
| RISK-04 | Revocation and re-grant semantics | A JWT from a wallet subsequently revoked and re-granted the same deployment membership could regain validity before its two-hour expiry. An explicit session invalidation requirement and lifecycle test would clarify intended behavior. |
| RISK-05 | Deployment writer interruption | The two deployment files are written sequentially at scripts/deployment-info.js lines 13–15. A process/disk failure between writes could leave inconsistent files. Frontend/backend checks reject a mismatch, but an interruption test was not performed. |
| RISK-06 | Development-server advisories | Several Windows Vite preconditions are present. Arbitrary editor execution, UNC/NTLM capture, and real local-secret file reads were excluded. Reachability and remediation are assessed per advisory in section 5. |
| RISK-07 | RPC trust and transport | The default Sepolia endpoint uses HTTPS. Configuration permits HTTP overrides and trusts a single RPC source for current roles. Malicious RPC substitution, DNS compromise, and long-running provider-failure behavior were not exercised. |
| RISK-08 | Growing member list | getMembers scans all historical members, including revoked entries. Creating membership requires Admin, so no lower-role expansion path was established. Large administrative history deserves a bounded read design. |

The source's API logging returns generic database/RPC errors to clients on tested paths. Local administrator access to configuration files, logs, wallet profiles, or SQLite files remains an operational trust boundary.

Public-chain records and transaction calldata are observable through Ethereum infrastructure. Role-gated read methods control application calls and cannot make stored asset information confidential.

## 8. Remediation Plan

| Priority | Action | Acceptance test |
|---|---|---|
| 1 | Address the Vite development advisories through a supported, reviewed tool update or reduced middleware exposure before broader developer-server access. | Re-run full and production audits, dev-server Windows tests with controlled fixtures, build, wallet login, and role CRUD checks. |
| 2 | Implement bounded asset reads and update the dashboard caller for AUD-01. Agree on an immutable-contract migration plan before implementation. | Load datasets exceeding the local reproduced threshold and keep each page below an explicit call/response budget. Preserve history and role checks. |
| 3 | Isolate outstanding login challenges and apply issuance limits/expiry cleanup for AUD-02 and RISK-01. | Two legitimate outstanding challenges survive unrelated issuance, each consumes once, and concurrent replay remains rejected. |
| 4 | Resolve lower-reachability development-tool advisories through owning packages. Avoid arbitrary major transitive overrides. | All Hardhat tests, scripts, compiler settings, and synchronization tests remain valid. |
| 5 | Decide JWT logout/re-grant semantics, RPC timeouts/concurrency budgets, and interrupted deployment-write behavior. | Add targeted lifecycle, simulated outage, and interrupted-write tests for the accepted requirements. |

No remediations were applied during this assessment.

## 9. Residual Risks

- This is a time-bounded targeted assessment. Formal verification, broad property-based fuzzing, prolonged resource exhaustion, and independent multi-auditor review were outside the executed work.
- Browser tests used isolated Chrome and a controlled wallet provider. This audit did not operate the user's MetaMask extension or inspect its stored keys.
- Active Sepolia security testing was excluded. The live initial Admin identity and the full current role-holder population were not independently enumerated. The user supplied the successful deployer-Admin verification.
- The exact live RPC gas/response ceiling and current registry-size exhaustion threshold were not measured. AUD-01's threshold belongs to its stated local fixture.
- Cross-origin local-network-access behavior depends on browser versions and policy. A malicious remote page's ability to reach this loopback service was not established.
- Development advisory PoCs that could cause command execution, credential capture, filesystem writes outside fixtures, or disclosure of real environment data were excluded.
- Secret-pattern scans cannot identify every credential format or establish strong entropy. The local JWT secret's value and personal SQLite records were omitted from evidence.
- Advisory data reflects the registry records retrieved for this audit and can change. Zero production audit findings do not establish source-code security.
- Solidity timestamp values describe block time. This application currently uses them as record metadata. Higher-assurance provenance, RPC trust, wallet custody, and operational recovery require separate requirements.

## 10. Final Security Assessment

No confirmed Critical or High application blocker was identified. The assessment confirmed **one Medium availability vulnerability and one Low availability vulnerability** under the documented deployment assumptions. Development dependencies include reported High advisories with platform- and call-path-specific prerequisites.

The four-role model, wallet-signature authentication, protected asset CRUD, profile authorization, and tested session resets behaved as specified. Read-only verification tied the current Sepolia deployment to the reviewed source. A controlled university demonstration with a small registry and restricted development-server access is reasonable with the disclosed findings accepted by the team.

The report supports a remediation decision and a repeatable set of tests. Future source, dependency, deployment, or exposure changes require renewed verification.

