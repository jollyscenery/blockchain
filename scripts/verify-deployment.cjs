// Read-only verification; never synchronizes or deploys a contract.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const hre = require("hardhat");
const tasks = require("hardhat/builtin-tasks/task-names");
const { ethers } = hre;
const a = require("../backend/contract.json");
const b = require("../frontend/src/contract.json");
const abi = require("../remix-abi.json");
async function main() {
  assert.deepEqual(a,b);
  assert.deepEqual(a.abi,abi);
  assert.equal(a.chainId,11155111);
  assert.equal(a.address,"0xda0349D26Fb38dfC3Cf416feB0a9670C5cb6ad1C");
  const provider = new ethers.JsonRpcProvider(require("./deployment-networks").getDeploymentRpcUrl(a.chainId));
  try {
    const network = await provider.getNetwork();
    const code = await provider.getCode(a.address);
    const block = await provider.getBlockNumber();
    assert.equal(network.chainId,11155111n);
    assert.equal(ethers.keccak256(code),a.codeHash);
    const sourceName="contracts/AssetRegistry.sol";
    const build = await hre.artifacts.getBuildInfo(sourceName+":AssetRegistry");
    assert.equal(build.input.sources[sourceName].content, fs.readFileSync(sourceName,"utf8"));
    const input={...build.input,settings:{...build.input.settings,evmVersion:"shanghai"}};
    const solc=await hre.run(tasks.TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,{solcVersion:build.solcVersion,quiet:true});
    const output=await(solc.isSolcJs?
      hre.run(tasks.TASK_COMPILE_SOLIDITY_RUN_SOLCJS,{input,solcJsPath:solc.compilerPath}):
      hre.run(tasks.TASK_COMPILE_SOLIDITY_RUN_SOLC,{input,solcPath:solc.compilerPath,solcVersion:build.solcVersion}));
    const compiled=output.contracts[sourceName].AssetRegistry;
    const strip=(value)=>value.slice(0,-(parseInt(value.slice(-4),16)+2)*2);
    assert.equal(strip(code),strip("0x"+compiled.evm.deployedBytecode.object));
    assert.deepEqual(new ethers.Interface(a.abi).format().sort(),new ethers.Interface(compiled.abi).format().sort());
    const registry = new ethers.Contract(a.address,a.abi,provider);
    assert.equal(await registry.getRole(ethers.ZeroAddress),0n);
    const result={address:a.address,chainId:Number(network.chainId),checkedAtBlock:block,codeHash:a.codeHash,
      bytecodeBytes:(code.length-2)/2,compiledSourceSHA256:require("node:crypto").createHash("sha256").update(build.input.sources[sourceName].content).digest("hex"),
      compiler:build.solcLongVersion,evmVersion:"shanghai",optimizer:input.settings.optimizer,
      executableBytecodeMatchesReviewedSource:true,abiMatchesCompiledSource:true,frontendBackendIdentical:true,
      sepoliaMethods:["eth_chainId","eth_getCode","eth_blockNumber","eth_call"],stateChangingSepoliaMethods:0};
    fs.mkdirSync("docker-audit-results/presubmission",{recursive:true});
    fs.writeFileSync("docker-audit-results/presubmission/sepolia-verification.json",JSON.stringify(result,null,2)+"\n");
    console.log(JSON.stringify(result,null,2));
  } finally {provider.destroy();}
}
main().catch((err)=>{console.error(err.message);process.exitCode=1;});

