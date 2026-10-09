import { build } from "esbuild";
import { mkdir, cp } from "node:fs/promises";
await mkdir(".local/runner-deps", { recursive: true });
for (const name of ["playwright", "playwright-core"])
  await cp("node_modules/" + name, ".local/runner-deps/" + name, {
    recursive: true,
    force: true,
  });
await build({
  entryPoints: ["packages/runner/browser.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".local/browser.mjs",
  external: ["playwright", "playwright/test"],
});
