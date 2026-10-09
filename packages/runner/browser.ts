import { chromium, type Page, type Locator } from "playwright";
import { expect } from "playwright/test";
import { readFile, unlink } from "node:fs/promises";
import { validateCase, type Target, type Step } from "../contracts/index.js";
let input = "";
for await (const c of process.stdin) {
  input += c;
  if (input.length > 1024 * 1024) throw Error("Manifest too large");
}
const m = JSON.parse(input);
const started = Date.now();
const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  proxy: {
    server: "http://proxy:9000",
    username: "run",
    password: m.proxyToken,
  },
  args: [
    "--disable-dev-shm-usage",
    "--proxy-bypass-list=<-loopback>",
    "--disable-quic",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: "en-US",
  timezoneId: "Asia/Kolkata",
  serviceWorkers: "block",
  acceptDownloads: false,
  extraHTTPHeaders: m.fixtureId ? { "X-Demo-Fixture": m.fixtureId } : {},
});
await context.route("**/*", (route) => {
  const u = new URL(route.request().url());
  return m.origins.includes(u.origin)
    ? route.continue()
    : route.abort("blockedbyclient");
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(30000);
const origin = new URL(m.baseUrl).origin;
const results: any[] = [];
let assertions = 0;
let outcome = "passed";
let error: string | undefined;
let cleanupOK = true;
function locator(target: Target): Locator {
  if (target.kind === "label")
    return page.getByLabel(target.value, { exact: true });
  if (target.kind === "testId") return page.getByTestId(target.value);
  return page.getByRole(target.role as any, {
    name: target.value,
    exact: true,
  });
}
async function step(s: Step) {
  const l = s.target ? locator(s.target) : null;
  switch (s.op) {
    case "navigate": {
      const u = new URL(s.path!, m.baseUrl);
      if (u.origin !== origin) throw Error("Navigation outside application");
      await page.goto(u.href, { waitUntil: "domcontentloaded" });
      break;
    }
    case "click":
      await l!.click();
      break;
    case "fill":
      await l!.fill(s.value!);
      break;
    case "select":
      await l!.selectOption({ label: s.value! });
      break;
    case "check":
      await l!.check();
      break;
    case "uncheck":
      await l!.uncheck();
      break;
    case "reload":
      await page.reload({ waitUntil: "domcontentloaded" });
      break;
    case "assertVisible":
      await expect(l!).toBeVisible({ timeout: 4000 });
      break;
    case "assertAbsent":
      await expect(l!).toHaveCount(0, { timeout: 4000 });
      break;
    case "assertText":
      await expect(l!).toContainText(s.value!, { timeout: 4000 });
      break;
    case "assertValue":
      await expect(l!).toHaveValue(s.value!, { timeout: 4000 });
      break;
    case "assertEnabled":
      await expect(l!).toBeEnabled({ timeout: 4000 });
      break;
    case "assertDisabled":
      await expect(l!).toBeDisabled({ timeout: 4000 });
      break;
    case "assertURL":
      await expect(page).toHaveURL(new URL(s.value!, m.baseUrl).href, {
        timeout: 4000,
      });
      break;
  }
}
async function login() {
  if (!m.login) return;
  const p = m.login;
  await page.goto(new URL(p.loginPath, m.baseUrl).href);
  await page.getByLabel(p.emailLabel, { exact: true }).fill(p.email);
  await page.getByLabel(p.passwordLabel, { exact: true }).fill(p.password);
  await page.getByRole("button", { name: p.submitName, exact: true }).click();
  await page.waitForURL((u) => u.pathname !== p.loginPath, { timeout: 10000 });
}
let output: any;
try {
  await login();
  if (m.kind === "discover") {
    for (const s of m.guided || []) await step(s);
    const queue = [
      ...(m.paths?.length ? m.paths : [new URL(m.baseUrl).pathname]),
    ];
    const seen = new Set<string>();
    const pages: any[] = [];
    while (queue.length && pages.length < Math.min(m.maxPages || 8, 20)) {
      const path = queue.shift()!;
      if (seen.has(path) || /logout|signout|delete|remove/i.test(path))
        continue;
      seen.add(path);
      await page.goto(new URL(path, m.baseUrl).href, {
        waitUntil: "domcontentloaded",
      });
      await page
        .locator("h1")
        .first()
        .waitFor({ state: "visible", timeout: 4000 })
        .catch(() => {});
      const snapshot = await page.evaluate(() => ({
        path: location.pathname,
        title: document.title,
        headings: [...document.querySelectorAll("h1,h2,h3")].map((e) =>
          e.textContent?.slice(0, 200),
        ),
        text: document.body.innerText.slice(0, 3000),
        controls: [
          ...document.querySelectorAll(
            "input,textarea,select,button,a,[data-testid]",
          ),
        ]
          .slice(0, 100)
          .map((e) => ({
            tag: e.tagName.toLowerCase(),
            label:
              (e as HTMLInputElement).labels?.[0]?.textContent?.trim() ||
              e.getAttribute("aria-label"),
            text: e.textContent?.trim().slice(0, 180),
            testId: e.getAttribute("data-testid"),
            type: e.getAttribute("type"),
            href: e.getAttribute("href"),
          })),
        links: [...document.querySelectorAll("a[href]")].map(
          (a) => (a as HTMLAnchorElement).href,
        ),
      }));
      if (!m.origins.includes(new URL(page.url()).origin))
        throw Error("Redirect outside approved origins");
      pages.push(snapshot);
      for (const link of snapshot.links) {
        const u = new URL(link);
        if (u.origin === origin && !u.search && !seen.has(u.pathname))
          queue.push(u.pathname);
      }
    }
    output = {
      state: "completed",
      pages,
      stopReason: queue.length
        ? "Page limit reached"
        : "Navigation links exhausted",
      browserVersion: browser.version(),
      durationMs: Date.now() - started,
    };
  } else {
    const c = validateCase(m.definition);
    if (m.trace)
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: false,
      });
    for (const [index, s] of c.steps.entries()) {
      const t = Date.now();
      try {
        await step(s);
        if (s.op.startsWith("assert")) assertions++;
        results.push({
          index,
          op: s.op,
          state: "passed",
          expected: s.value ?? s.path ?? s.target?.value,
          durationMs: Date.now() - t,
        });
      } catch (e) {
        outcome = "failed";
        error = (e as Error).message.slice(0, 4000);
        results.push({
          index,
          op: s.op,
          state: "failed",
          expected: s.value ?? s.path ?? s.target?.value,
          error,
          durationMs: Date.now() - t,
        });
        break;
      }
    }
    const evidence: any[] = [];
    try {
      const screenshot = await page.screenshot({
        fullPage: false,
        mask: [page.locator("input[type=password]")],
      });
      evidence.push({
        kind: "screenshot",
        data: screenshot.toString("base64"),
      });
    } catch {
      cleanupOK = false;
    }
    for (const s of c.cleanup) {
      try {
        await step(s);
      } catch {
        cleanupOK = false;
      }
    }
    if (m.trace) {
      try {
        await context.tracing.stop({ path: "/tmp/trace.zip" });
        const trace = await readFile("/tmp/trace.zip");
        if (trace.length <= 10 * 1024 * 1024)
          evidence.push({ kind: "trace", data: trace.toString("base64") });
        else cleanupOK = false;
        await unlink("/tmp/trace.zip");
      } catch {
        cleanupOK = false;
      }
    }
    output = {
      outcome,
      error,
      steps: results,
      assertions,
      cleanupOK,
      durationMs: Date.now() - started,
      evidence,
      browserVersion: browser.version(),
    };
  }
} catch (e) {
  output = {
    outcome: "errored",
    error: (e as Error).message.slice(0, 2000),
    steps: results,
    assertions,
    cleanupOK: false,
    durationMs: Date.now() - started,
    evidence: [],
  };
} finally {
  await browser.close();
}
process.stdout.write(JSON.stringify(output));
