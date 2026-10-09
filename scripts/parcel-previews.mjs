import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const repository = path.resolve(process.env.PARCEL_REPO_PATH || "demo-project");
if (!existsSync(path.join(repository, "server.mjs")))
  throw Error(
    "Clone parcel-regression-demo into demo-project first (see docs/Parcel_PR_Demo.md).",
  );
const previews = [
  ["main", repository, 4180],
  [
    "demo-101-free-delivery-boundary",
    path.resolve(".local/parcel-previews/demo-101"),
    4181,
  ],
  [
    "demo-102-promo-normalization",
    path.resolve(".local/parcel-previews/demo-102"),
    4182,
  ],
  [
    "demo-103-gift-wrapping",
    path.resolve(".local/parcel-previews/demo-103"),
    4183,
  ],
];
mkdirSync(".local/parcel-previews", { recursive: true });
const git = (cwd, args) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
for (const [branch, directory] of previews) {
  if (!existsSync(path.join(directory, "server.mjs"))) {
    let local = false;
    try {
      git(repository, ["rev-parse", "--verify", `refs/heads/${branch}`]);
      local = true;
    } catch {}
    git(repository, [
      "worktree",
      "add",
      ...(local ? [] : ["--track", "-b", branch]),
      directory,
      local ? branch : `origin/${branch}`,
    ]);
  }
  if (git(directory, ["branch", "--show-current"]) !== branch)
    throw Error(
      `Expected ${branch} in ${directory}. Switch it explicitly before starting previews.`,
    );
}
const children = previews.map(([branch, cwd, port]) => {
  console.log(`Starting ${branch} at http://127.0.0.1:${port}`);
  return spawn(process.execPath, ["server.mjs"], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit",
  });
});
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1000);
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
}
