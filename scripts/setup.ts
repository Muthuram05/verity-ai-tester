import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
mkdirSync(".local", { recursive: true, mode: 0o700 });
if (existsSync(".env")) {
  console.log("Local configuration already exists; preserved.");
  process.exit(0);
}
const secret = () => randomBytes(32).toString("hex");
const admin = secret(),
  app = secret(),
  queue = secret();
const values = {
  PG_PASSWORD: admin,
  APP_DB_PASSWORD: app,
  QUEUE_DB_PASSWORD: queue,
  DATABASE_ADMIN_URL: `postgresql://aitester_admin:${admin}@127.0.0.1:5433/aitester`,
  DATABASE_URL: `postgresql://aitester_app:${app}@127.0.0.1:5433/aitester`,
  QUEUE_DATABASE_URL: `postgresql://aitester_queue:${queue}@127.0.0.1:5433/aitester`,
  ENCRYPTION_KEY: secret(),
  PROXY_KEY: secret(),
  DEMO_KEY: secret(),
  SETUP_TOKEN: secret(),
  API_PORT: "4000",
  WEB_ORIGIN: "http://127.0.0.1:3000",
  DEMO_ORIGIN: "http://127.0.0.1:4174",
  CODEX_BIN: "codex",
};
writeFileSync(
  ".env",
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
chmodSync(".env", 0o600);
console.log(
  "Generated .env with private local secrets. Start infrastructure, migrate, then open the setup screen.",
);
