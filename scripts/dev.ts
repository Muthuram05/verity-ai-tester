import { spawn } from "node:child_process";
const children = [
  ["--import", "tsx", "apps/api/server.ts"],
  ["--import", "tsx", "apps/worker/main.ts"],
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "3000",
    "--strictPort",
  ],
].map((args) =>
  spawn(process.execPath, args, { stdio: "inherit", env: process.env }),
);
let exiting = false;
const stop = () => {
  if (exiting) return;
  exiting = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(0), 3000);
};
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, stop);
for (const c of children)
  c.on("exit", (code) => {
    if (!exiting) {
      console.error("A development service stopped:", code);
      stop();
    }
  });
