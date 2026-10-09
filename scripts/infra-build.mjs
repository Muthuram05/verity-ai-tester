import { spawnSync } from "node:child_process";
const run = (bin, args) => {
  const r = spawnSync(bin, args, { stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status || 1);
};
run(process.execPath, ["scripts/build-runner.mjs"]);
const cached =
  spawnSync("docker", ["image", "inspect", "aitester-demo:latest"], {
    stdio: "ignore",
  }).status === 0;
run("docker", [
  "compose",
  "--env-file",
  ".env",
  "build",
  ...(cached ? ["--build-arg", "SERVICES_BASE=aitester-demo:latest"] : []),
]);
run("docker", [
  "build",
  "-f",
  "infrastructure/runner.Dockerfile",
  "-t",
  "aitester-runner:local",
  ".",
]);
