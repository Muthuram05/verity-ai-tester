import "dotenv/config";
import { spawn } from "node:child_process";
import { proxyToken } from "../packages/domain/security.js";
import { writeFile } from "node:fs/promises";

// The probe runs inside the same internal Docker network as test browsers.
// Only a narrowly scoped proxy capability is passed over stdin.
const probe = String.raw`
const http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict');
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',async()=>{
const {token}=JSON.parse(input);const headers={'Proxy-Authorization':'Basic '+Buffer.from('run:'+token).toString('base64')};
const request=(url,auth=true)=>new Promise((resolve,reject)=>{const q=http.request({host:'proxy',port:9000,path:url,headers:auth?headers:{},timeout:5000},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});q.on('error',reject);q.on('timeout',()=>q.destroy(Error('Timeout')));q.end();});
assert.equal(await request('http://127.0.0.1:4174/__build',false),407);
assert.equal(await request('http://127.0.0.1:4174/__build'),200);
assert.equal(await request('http://127.0.0.1:5433/'),403);
assert.equal(await request('http://169.254.169.254/latest/meta-data/'),403);
assert.equal(await request('http://example.com/'),403);
await new Promise((resolve,reject)=>{const s=net.connect({host:'1.1.1.1',port:443});s.setTimeout(1500);s.on('connect',()=>{s.destroy();reject(Error('Internal runner network unexpectedly has direct internet access'));});s.on('error',()=>resolve());s.on('timeout',()=>{s.destroy();resolve();});});
console.log(JSON.stringify({proxyAuthentication:true,approvedTarget:true,infrastructureBlocked:true,metadataBlocked:true,unapprovedOriginsBlocked:true,directInternetBlocked:true}));
}).on('error',e=>{console.error(e.message);process.exit(1)});`;
const child = spawn(
  "docker",
  [
    "run",
    "--rm",
    "-i",
    "--network",
    "aitester_execution",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "aitester-demo:latest",
    "node",
    "-e",
    probe,
  ],
  { stdio: ["pipe", "pipe", "pipe"] },
);
let output = "",
  error = "";
child.stdout.on("data", (c) => (output += c));
child.stderr.on("data", (c) => (error += c));
child.stdin.end(
  JSON.stringify({ token: proxyToken(["http://127.0.0.1:4174"]) }),
);
const code = await new Promise((resolve) => child.on("close", resolve));
if (code !== 0) throw Error(error.slice(-1500));
const checks = JSON.parse(output);
await writeFile(
  ".local/verification-network.json",
  JSON.stringify({ at: new Date().toISOString(), checks }, null, 2),
);
console.log(checks);
