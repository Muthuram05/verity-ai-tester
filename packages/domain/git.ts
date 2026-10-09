import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
const exec = promisify(execFile);
export async function git(path: string, args: string[]) {
  return (
    await exec(
      "git",
      [
        "--no-optional-locks",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-C",
        path,
        ...args,
      ],
      {
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    )
  ).stdout.trim();
}
export async function repository(path: string) {
  const real = await realpath(path);
  const root = await git(real, ["rev-parse", "--show-toplevel"]);
  return realpath(root);
}
export async function changes(path: string, base: string, head: string) {
  for (const ref of [base, head])
    if (!/^[A-Za-z0-9][A-Za-z0-9._/~^\-]{0,150}$/.test(ref))
      throw Error("Invalid Git revision");
  const resolve = (ref: string) =>
    git(path, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  const [baseSHA, headSHA] = await Promise.all([resolve(base), resolve(head)]);
  const output = await git(path, [
    "diff",
    "--name-only",
    "--no-ext-diff",
    "--no-textconv",
    baseSHA,
    headSHA,
    "--",
  ]);
  return { baseSHA, headSHA, files: output ? output.split("\n") : [] };
}
