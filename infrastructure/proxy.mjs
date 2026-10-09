import http from "node:http";
import net from "node:net";
import dns from "node:dns/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
const privateIP = (ip) =>
  !net.isIPv4(ip) ||
  /^(0\.|10\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|192\.0\.|198\.(18|19)\.|22[4-9]\.|2[3-5]\d\.)/.test(
    ip,
  );
function claims(req) {
  const v = Buffer.from(
    (req.headers["proxy-authorization"] || "").replace(/^Basic /, ""),
    "base64",
  )
    .toString()
    .split(":")
    .slice(1)
    .join(":");
  const [payload, sig] = v.split(".");
  if (!payload || !sig) throw Error("Proxy authentication required");
  const expected = createHmac("sha256", process.env.PROXY_KEY)
    .update(payload)
    .digest("hex");
  if (
    sig.length !== expected.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    throw Error("Invalid capability");
  const c = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (c.expires < Date.now()) throw Error("Capability expired");
  return c;
}
async function destination(req, url) {
  const c = claims(req);
  if (!c.origins.includes(url.origin))
    throw Error("Destination is outside approved origins");
  if (
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw Error("Unsupported target");
  if (url.origin === "http://127.0.0.1:4174")
    return { host: "demo", port: 4174 };
  if (["localhost", "127.0.0.1"].includes(url.hostname)) {
    const port = Number(url.port);
    if (
      !c.localPorts?.includes(port) ||
      [3000, 4000, 4001, 5432, 5433, 9000, 27017, 6379].includes(port) ||
      port < 1024
    )
      throw Error("Local port blocked");
    return { host: "host.docker.internal", port };
  }
  const resolved = await dns.lookup(url.hostname, { family: 4, all: true });
  if (!resolved.length || resolved.some((x) => privateIP(x.address)))
    throw Error("Private address blocked");
  return {
    host: resolved[0].address,
    port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
  };
}
const server = http.createServer(async (req, res) => {
  if (!req.headers["proxy-authorization"]) {
    res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="Verity runner"' });
    res.end();
    return;
  }
  try {
    const u = new URL(req.url);
    const d = await destination(req, u);
    if (u.protocol !== "http:") throw Error("Use CONNECT");
    const headers = { ...req.headers, host: u.host };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const out = http.request(
      {
        ...d,
        path: u.pathname + u.search,
        method: req.method,
        headers,
        timeout: 30000,
      },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      },
    );
    out.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("Target unavailable");
    });
    out.on("timeout", () => out.destroy());
    req.pipe(out);
  } catch (e) {
    res.writeHead(403);
    res.end("Destination blocked");
  }
});
server.on("connect", async (req, socket, head) => {
  if (!req.headers["proxy-authorization"]) {
    socket.end(
      'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Verity runner"\r\nContent-Length: 0\r\n\r\n',
    );
    return;
  }
  try {
    const u = new URL("https://" + req.url);
    const d = await destination(req, u);
    const out = net.connect(d.port, d.host, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) out.write(head);
      out.pipe(socket);
      socket.pipe(out);
    });
    out.setTimeout(120000, () => out.destroy());
    out.on("error", () => socket.destroy());
    socket.on("error", () => out.destroy());
  } catch {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  }
});
server.on("upgrade", (_r, s) => s.end("HTTP/1.1 403 Forbidden\r\n\r\n"));
server.listen(9000, "0.0.0.0");
