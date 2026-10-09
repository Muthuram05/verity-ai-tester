import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
const state = JSON.parse(
  await readFile(".local/verification-state.json", "utf8"),
);
await mkdir(".local/screenshots", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.UI_BROWSER_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors: string[] = [];
let evidenceViews = 0;
page.on("pageerror", (error) => errors.push(error.message));
await page.goto("http://127.0.0.1:3000");
await page.getByLabel("Email address", { exact: true }).fill(owner.email);
await page.getByLabel("Password", { exact: true }).fill(owner.password);
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.getByRole("heading", { name: "Regression overview" }).waitFor();
await page.screenshot({
  path: ".local/screenshots/overview-desktop.png",
  fullPage: true,
});
for (const [route, heading] of [
  [`projects/${state.projectId}`, "Gather community"],
  ["scenarios", "Scenario library"],
  ["runs", "Regression history"],
  ["changes", "Change analysis"],
  ["schedules", "Scheduled regression"],
  ["settings", "Workspace settings"],
]) {
  await page.goto("http://127.0.0.1:3000/#" + route);
  await page
    .getByRole("heading", { name: heading, exact: true })
    .waitFor({ timeout: 10000 });
  await page.screenshot({
    path: ".local/screenshots/" + route.split("/")[0] + "-desktop.png",
    fullPage: true,
  });
  console.log("PASS dashboard route " + route.split("/")[0]);
}
const regression = await readFile(".local/verification-browser.json", "utf8")
  .then((value) => JSON.parse(value))
  .catch(() => null);
for (const check of regression?.checks || []) {
  const runId = check.details?.runId;
  if (!runId) continue;
  await page.goto("http://127.0.0.1:3000/#runs/" + runId);
  await page
    .getByRole("heading", { name: "Run " + runId.slice(0, 8), exact: true })
    .waitFor();
  const screenshot = page
    .getByRole("img", { name: /^Browser evidence for / })
    .first();
  await screenshot.waitFor();
  await screenshot.evaluate((img: HTMLImageElement) => img.decode());
  assert(
    await screenshot.evaluate((img: HTMLImageElement) => img.naturalWidth > 0),
  );
  const trace = page
    .getByRole("link", { name: "Download Playwright trace" })
    .first();
  if (await trace.count()) {
    const response = await page.request.get(
      new URL((await trace.getAttribute("href"))!, page.url()).href,
    );
    assert(response.ok());
    assert.equal((await response.body()).subarray(0, 2).toString(), "PK");
  }
  await page.screenshot({
    path: `.local/screenshots/run-${runId.slice(0, 8)}-desktop.png`,
    fullPage: true,
  });
  evidenceViews++;
}
if (evidenceViews)
  console.log(
    `PASS ${evidenceViews} regression evidence views with real images and trace downloads`,
  );
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:3000/#overview");
await page.getByRole("heading", { name: "Regression overview" }).waitFor();
await page.screenshot({
  path: ".local/screenshots/overview-mobile.png",
  fullPage: true,
});
assert(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  "Mobile page overflows horizontally",
);
assert.deepEqual(errors, []);
await writeFile(
  ".local/verification-ui.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      routes: 7 + evidenceViews,
      evidenceViews,
      mobileWidth: 390,
      consoleErrors: errors,
    },
    null,
    2,
  ),
);
await browser.close();
console.log("PASS responsive dashboard without JavaScript errors");
