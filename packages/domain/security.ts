import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
} from "node:crypto";
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
export const hash = (v: unknown) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : JSON.stringify(canonical(v)))
    .digest("hex");
export function encrypt(v: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.ENCRYPTION_KEY!, "hex"),
    iv,
  );
  const data = Buffer.concat([
    cipher.update(JSON.stringify(v), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: data.toString("hex"),
  };
}
export function decrypt(v: any) {
  const d = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.ENCRYPTION_KEY!, "hex"),
    Buffer.from(v.iv, "hex"),
  );
  d.setAuthTag(Buffer.from(v.tag, "hex"));
  return JSON.parse(
    Buffer.concat([d.update(Buffer.from(v.data, "hex")), d.final()]).toString(),
  );
}
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}
export function targetURL(value: string) {
  const u = new URL(value);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.hash
  )
    throw new InputError(
      "Enter an HTTP or HTTPS application URL without embedded credentials",
    );
  const local = ["localhost", "127.0.0.1"].includes(u.hostname);
  if (
    local &&
    (!u.port ||
      Number(u.port) < 1024 ||
      [3000, 4000, 4001, 5432, 5433, 9000, 27017, 6379].includes(
        Number(u.port),
      ))
  )
    throw new InputError(
      "This local infrastructure port cannot be a test target",
    );
  if (
    !local &&
    (/^(\d+\.){3}\d+$/.test(u.hostname) ||
      u.hostname.includes(":") ||
      !u.hostname.includes(".") ||
      u.hostname.endsWith(".local"))
  )
    throw new InputError(
      "Use a public domain or an explicit localhost application port",
    );
  return u;
}
export function proxyToken(origins: string[]) {
  const clean = [...new Set(origins.map((o) => targetURL(o).origin))];
  const payload = Buffer.from(
    JSON.stringify({
      origins: clean,
      localPorts: clean
        .map((o) => new URL(o))
        .filter((u) => ["127.0.0.1", "localhost"].includes(u.hostname))
        .map((u) => Number(u.port)),
      expires: Date.now() + 65 * 60 * 1000,
    }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", process.env.PROXY_KEY!).update(payload).digest("hex")}`;
}
export function redact(s: string) {
  return s
    .replace(/Bearer\s+[\w.\-]+/gi, "Bearer [redacted]")
    .replace(
      /(password|api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    );
}
export function csv(s: unknown) {
  let v = String(s ?? "");
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  return '"' + v.replaceAll('"', '""') + '"';
}
export const escapeHTML = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
