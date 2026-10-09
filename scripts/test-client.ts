import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export class Client {
  cookie = "";
  csrf = "";
  async request(
    method: string,
    path: string,
    body?: unknown,
    expected = 200,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch("http://127.0.0.1:4000/api/v1" + path, {
      method,
      headers: {
        cookie: this.cookie,
        "x-csrf-token": this.csrf,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookie = response.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (response.status !== expected)
      throw Error(
        `${method} ${path}: expected ${expected}, received ${response.status}: ${JSON.stringify(data).slice(0, 800)}`,
      );
    if (data?.csrf) this.csrf = data.csrf;
    return data;
  }
}
export async function ownerClient() {
  await mkdir(".local", { recursive: true, mode: 0o700 });
  const client = new Client();
  const status = await client.request("GET", "/setup/status");
  let owner: any;
  try {
    owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  } catch {}
  if (status.required) {
    owner = {
      name: "Project owner",
      email: "owner@verity.local",
      password: randomBytes(18).toString("base64url"),
    };
    await writeFile(".local/owner.json", JSON.stringify(owner, null, 2), {
      mode: 0o600,
    });
    await client.request("POST", "/setup", {
      ...owner,
      setupToken: process.env.SETUP_TOKEN,
    });
  } else {
    if (!owner)
      throw Error(
        "Local test owner credentials are unavailable. Sign in through the app instead.",
      );
    await client.request("POST", "/sessions", {
      email: owner.email,
      password: owner.password,
    });
  }
  return { client, owner };
}
export async function waitFor<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  timeout = 1800000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw Error("Timed out waiting for background work");
}
