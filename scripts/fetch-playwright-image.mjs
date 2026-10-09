// Optional ARM64 registry-download recovery, executed in the project's Node container.
// Downloads only the pinned official image and verifies every registry digest.
import { mkdir, readFile, writeFile, open, rename } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const directory = process.argv[2];
if (process.arch !== "arm64")
  throw Error(
    "This recovery manifest is pinned to Linux ARM64; use the normal Docker build on other architectures.",
  );
if (!directory) throw Error("Pass a directory for the verified image files.");
await mkdir(directory, { recursive: true });
const origin = "https://mcr.microsoft.com/v2/playwright";
const digest =
  "sha256:4109b399f6d3de22a133ab935df0d7614ed0de9195d529f0ebc6255655cdb495";
const manifestResponse = await fetch(origin + "/manifests/" + digest, {
  headers: {
    accept:
      "application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.manifest.v1+json",
  },
  signal: AbortSignal.timeout(30000),
});
if (!manifestResponse.ok)
  throw Error("Official manifest unavailable: " + manifestResponse.status);
const raw = Buffer.from(await manifestResponse.arrayBuffer());
const sha = (data) => createHash("sha256").update(data).digest("hex");
if ("sha256:" + sha(raw) !== digest) throw Error("Manifest digest mismatch");
const manifest = JSON.parse(raw);
const descriptors = [manifest.config, ...manifest.layers];
if (descriptors.reduce((n, d) => n + d.size, 0) > 1500 * 1024 * 1024)
  throw Error("Unexpected image size");
const block = 1024 * 1024;
let completed = 0;
async function fileHash(file) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
async function range(descriptor, start, end) {
  for (let retry = 0; retry < 4; retry++) {
    try {
      const r = await fetch(origin + "/blobs/" + descriptor.digest, {
        headers: { Range: `bytes=${start}-${end}` },
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw Error("Registry blob HTTP " + r.status);
      if (r.status !== 206 && descriptor.size > block) {
        await r.body.cancel();
        throw Error("Registry did not honor bounded range");
      }
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length !== end - start + 1)
        throw Error("Registry range length mismatch");
      return bytes;
    } catch (e) {
      if (retry === 3) throw e;
    }
  }
}
let next = 0;
await Promise.all(
  Array.from({ length: 2 }, async () => {
    while (next < descriptors.length) {
      const d = descriptors[next++];
      if (!/^sha256:[a-f0-9]{64}$/.test(d.digest))
        throw Error("Unexpected registry digest");
      const name = d.digest.slice(7),
        file = path.join(directory, name);
      try {
        if ((await fileHash(file)) === name) {
          completed += d.size;
          continue;
        }
      } catch {}
      const handle = await open(file + ".part", "w");
      let offset = 0,
        lastReport = 0;
      try {
        await Promise.all(
          Array.from({ length: 4 }, async () => {
            while (offset < d.size) {
              const start = offset;
              offset += block;
              const end = Math.min(d.size - 1, start + block - 1);
              const data = await range(d, start, end);
              await handle.write(data, 0, data.length, start);
              completed += data.length;
              if (completed - lastReport > 64 * 1024 * 1024) {
                lastReport = completed;
                console.log(
                  "Downloaded " +
                    Math.round(completed / 1024 / 1024) +
                    " MiB of official image",
                );
              }
            }
          }),
        );
      } finally {
        await handle.close();
      }
      if ((await fileHash(file + ".part")) !== name)
        throw Error("Registry layer digest mismatch");
      await rename(file + ".part", file);
      console.log("Verified image layer " + name.slice(0, 12));
    }
  }),
);
await writeFile(
  path.join(directory, "manifest.json"),
  JSON.stringify([
    {
      Config: manifest.config.digest.slice(7),
      RepoTags: [
        "mcr.microsoft.com/playwright:v1.64.0-noble",
        "aitester-playwright-base:local",
      ],
      Layers: manifest.layers.map((d) => d.digest.slice(7)),
    },
  ]),
);
console.log("Official image download complete; all digests verified.");
