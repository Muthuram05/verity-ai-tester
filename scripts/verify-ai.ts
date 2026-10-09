import "dotenv/config";
import { verifyProvider, providerStatus } from "../packages/ai/codex.js";
import { writeFile, mkdir } from "node:fs/promises";
console.log(await providerStatus());
const result = await verifyProvider();
await mkdir(".local", { recursive: true });
await writeFile(".local/ai-readiness.json", JSON.stringify(result, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(result, null, 2));
