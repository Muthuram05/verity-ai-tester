import "dotenv/config";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { proxyToken, redact } from "../domain/security.js";
const exec = promisify(execFile);
export async function runnerReady() {
  try {
    await exec(
      "docker",
      ["image", "inspect", "aitester-runner:local", "--format", "{{.Id}}"],
      { timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}
export async function cleanupOrphanRunners() {
  const { stdout } = await exec(
    "docker",
    ["ps", "-aq", "--filter", "label=app=aitester"],
    { timeout: 10000 },
  );
  const ids = stdout
    .trim()
    .split(/\s+/)
    .filter((id) => /^[a-f0-9]{12,64}$/.test(id));
  if (ids.length)
    await exec("docker", ["rm", "-f", ...ids], { timeout: 20000 });
}
let slots = 0;
const waiting: (() => void)[] = [];
async function acquire() {
  if (slots < 2) slots++;
  else await new Promise<void>((r) => waiting.push(r));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else slots--;
}
export async function executeBrowser(manifest: any, signal?: AbortSignal) {
  await acquire();
  const name = "aitester-job-" + randomUUID();
  let stop: Promise<any> | undefined;
  const remove = () =>
    (stop ??= exec("docker", ["rm", "-f", name], { timeout: 10000 }).catch(
      () => {},
    ));
  try {
    if (signal?.aborted) throw Error("Run cancelled");
    return await new Promise<any>((resolve, reject) => {
      const args = [
        "run",
        "--rm",
        "--init",
        "-i",
        "--name",
        name,
        "--label",
        "app=aitester",
        "--network",
        "aitester_execution",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,exec,size=536870912,mode=1777",
        "--tmpfs",
        "/home/pwuser:rw,size=16777216,uid=1000,gid=1000",
        "--shm-size",
        "256m",
        "--memory",
        "1g",
        "--cpus",
        "1",
        "--pids-limit",
        "256",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--security-opt",
        `seccomp=${path.resolve("infrastructure/seccomp_profile.json")}`,
        "aitester-runner:local",
      ];
      const child = spawn("docker", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DOCKER_HOST: process.env.DOCKER_HOST,
        },
      });
      let output = "",
        error = "";
      let failure: Error | undefined;
      const abort = () => {
        failure = Error(
          signal?.aborted ? "Run cancelled" : "Browser execution timed out",
        );
        void remove();
        child.kill("SIGTERM");
      };
      const timeout = setTimeout(
        abort,
        manifest.kind === "discover" ? 600000 : 130000,
      );
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.length > 18 * 1024 * 1024) {
          failure = Error("Artifact output limit exceeded");
          abort();
        }
      });
      child.stderr.on("data", (chunk) => {
        error = (error + chunk).slice(-6000);
      });
      child.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        if (failure) return reject(failure);
        if (code !== 0)
          return reject(
            Error("Browser sandbox failed: " + redact(error).slice(0, 3000)),
          );
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(Error("Browser returned invalid results"));
        }
      });
      child.stdin.end(
        JSON.stringify({
          ...manifest,
          proxyToken: proxyToken(manifest.origins),
        }),
      );
    });
  } finally {
    await remove();
    release();
  }
}
export async function demoFixture(id: string = randomUUID()) {
  const r = await fetch(process.env.DEMO_ORIGIN + "/__fixtures", {
    method: "POST",
    headers: {
      "x-demo-key": process.env.DEMO_KEY!,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id }),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw Error("Demo fixture setup failed");
  return ((await r.json()) as any).id as string;
}
export async function cleanupFixture(id: string) {
  const r = await fetch(
    process.env.DEMO_ORIGIN + "/__fixtures/" + encodeURIComponent(id),
    {
      method: "DELETE",
      headers: { "x-demo-key": process.env.DEMO_KEY! },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!r.ok) throw Error("Fixture cleanup failed");
}
