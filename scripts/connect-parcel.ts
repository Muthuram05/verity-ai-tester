import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ownerClient, waitFor } from "./test-client.js";
import type { Step, TestCase, Target } from "../packages/contracts/index.js";

const { client } = await ownerClient();
const repository = path.resolve(process.env.PARCEL_REPO_PATH || "demo-project");
const output = ".local/parcel-connection.json";
const target = (
  kind: Target["kind"],
  value: string,
  role: Target["role"] = null,
): Target => ({ kind, value, role });
const step = (
  op: Step["op"],
  t: Target | null = null,
  value: string | null = null,
  p: string | null = null,
): Step => ({ op, target: t, value, path: p });
const go = () => step("navigate", null, null, "/");
const fill = (name: string, value: string) =>
  step("fill", target("label", name), value);
const update = () => step("click", target("role", "Update order", "button"));
const amount = (name: string, value: string) =>
  step("assertText", target("testId", name), value);
const terminal = (r: any) =>
  ["completed", "errored", "cancelled"].includes(r.run.state);

if (process.argv.includes("--verify")) {
  const connection = JSON.parse(await readFile(output, "utf8"));
  const baseline = connection.cases.filter((c: any) => c.group === "baseline");
  const results: any[] = [];
  for (const env of connection.environments) {
    const cases = [
      ...baseline,
      ...connection.cases.filter((c: any) => c.group === env.branch),
    ];
    // Approval is explicit for these authored, reviewed, read-only demo definitions.
    for (const c of cases)
      await client.request("POST", `/case-versions/${c.id}/approvals`, {
        hash: c.hash,
      });
    const revision = execFileSync(
      "git",
      ["-C", repository, "rev-parse", env.branch],
      { encoding: "utf8" },
    ).trim();
    const before = await fetch(new URL("/__build", env.baseUrl)).then((r) =>
      r.json(),
    );
    assert.equal(
      before.revision,
      revision,
      "Preview must serve the selected branch commit",
    );
    const queued = await client.request(
      "POST",
      "/runs",
      {
        projectId: connection.projectId,
        environmentId: env.id,
        versionIds: cases.map((c: any) => c.id),
        trace: true,
        retry: false,
      },
      202,
      { "idempotency-key": randomUUID() },
    );
    console.log(`Running ${env.branch}: ${queued.runId}`);
    const result = await waitFor(
      () => client.request("GET", "/runs/" + queued.runId),
      terminal,
    );
    const after = await fetch(new URL("/__build", env.baseUrl)).then((r) =>
      r.json(),
    );
    assert.equal(after.revision, revision);
    const entry = {
      branch: env.branch,
      revision,
      environmentId: env.id,
      runId: queued.runId,
      verdict: result.run.verdict,
      passed: result.cases.filter((c: any) => c.outcome === "passed").length,
      failures: result.cases
        .filter((c: any) => c.outcome !== "passed")
        .map((c: any) => ({ title: c.title, outcome: c.outcome })),
      artifactCount: result.artifacts.length,
      buildVerification:
        "Local verification script checked preview revision before and after; runner build identity remains unverified for external targets.",
    };
    results.push(entry);
    await writeFile(
      ".local/verification-parcel.json",
      JSON.stringify(
        {
          at: new Date().toISOString(),
          projectId: connection.projectId,
          results,
        },
        null,
        2,
      ),
    );
    if (env.branch === "demo-102-promo-normalization") {
      assert.equal(result.run.verdict, "failed");
      assert.deepEqual(
        entry.failures.map((c: any) => c.title).sort(),
        [
          "SAVE10 discounts items by ten percent",
          "Lowercase promotion preserves the ten-percent discount",
        ].sort(),
      );
    } else
      assert.equal(
        result.run.verdict,
        "passed",
        JSON.stringify(result.attempts.map((a: any) => a.error)),
      );
    console.log(
      `PASS expected ${env.branch} outcome: ${entry.passed}/${cases.length} passed`,
    );
    for (const c of cases.filter((c: any) => c.group !== "baseline"))
      await client.request("POST", `/case-versions/${c.id}/review`, {
        status: "draft",
      });
  }
  console.log(
    "Branch-specific acceptance scenarios returned to draft; the seven baseline cases remain approved.",
  );
} else {
  const projects = await client.request("GET", "/projects");
  let project = projects.find((p: any) => p.name === "Parcel checkout");
  if (!project)
    project = await client.request(
      "POST",
      "/projects",
      {
        name: "Parcel checkout",
        description:
          "Owned checkout app with three independent GitHub PR previews: correct fix, regression, and gift-wrapping feature.",
        baseUrl: "http://127.0.0.1:4180",
      },
      201,
    );
  let detail = await client.request("GET", "/projects/" + project.id);
  await client.request("POST", `/projects/${project.id}/repository`, {
    path: repository,
    modulePaths: { Checkout: "src/checkout/" },
  });
  const requirements: Record<string, string> = {};
  for (const [title, body] of [
    [
      "Checkout rules",
      "Notebook ₹500, pen set ₹450, desk pad ₹1,000. Quantity is a whole number from 1 to 10. SAVE10 discounts items by exactly 10%, rounded to whole rupees. Codes ignore case and surrounding whitespace. Invalid codes show Promotion code is not valid. Delivery costs ₹50 below ₹1,000 after discounts and is free at or above ₹1,000.",
    ],
    [
      "Gift wrapping feature proposal",
      "On DEMO-103, optional gift wrapping costs ₹75 once per order, defaults off, is shown separately, and is not discounted by SAVE10. Unchecking removes the fee. This feature is not yet present on main.",
    ],
  ]) {
    const existing = detail.requirements.find((r: any) => r.title === title);
    requirements[title] =
      existing?.id ||
      (
        await client.request(
          "POST",
          `/projects/${project.id}/requirements`,
          { title, body },
          201,
        )
      ).id;
  }
  const specifications: [string, string, Step[]][] = [
    [
      "baseline",
      "A notebook includes standard delivery",
      [go(), amount("total", "₹550.00")],
    ],
    [
      "baseline",
      "Product and quantity recalculate the order",
      [
        go(),
        step("select", target("label", "Product"), "Studio pen set — ₹450"),
        fill("Quantity", "2"),
        update(),
        amount("subtotal", "₹900.00"),
        amount("total", "₹950.00"),
      ],
    ],
    [
      "baseline",
      "Orders above the threshold have free delivery",
      [
        go(),
        fill("Quantity", "3"),
        update(),
        amount("shipping", "₹0.00"),
        amount("total", "₹1,500.00"),
      ],
    ],
    [
      "baseline",
      "SAVE10 discounts items by ten percent",
      [
        go(),
        fill("Quantity", "2"),
        fill("Promotion code", "SAVE10"),
        update(),
        amount("discount", "₹100.00"),
        amount("total", "₹950.00"),
      ],
    ],
    [
      "baseline",
      "Lowercase promotion preserves the ten-percent discount",
      [
        go(),
        fill("Promotion code", "save10"),
        update(),
        amount("discount", "₹50.00"),
        amount("total", "₹500.00"),
      ],
    ],
    [
      "baseline",
      "Invalid promotion codes show a validation error",
      [
        go(),
        fill("Promotion code", "INVALID"),
        update(),
        step(
          "assertText",
          target("role", "", "alert"),
          "Promotion code is not valid.",
        ),
      ],
    ],
    [
      "baseline",
      "Maximum quantity calculates correctly",
      [go(), fill("Quantity", "10"), update(), amount("total", "₹5,000.00")],
    ],
    [
      "demo-101-free-delivery-boundary",
      "DEMO-101: Exactly 1000 qualifies for free delivery",
      [
        go(),
        fill("Quantity", "2"),
        update(),
        amount("shipping", "₹0.00"),
        amount("total", "₹1,000.00"),
      ],
    ],
    [
      "demo-102-promo-normalization",
      "DEMO-102: Whitespace no longer rejects a promotion",
      [
        go(),
        fill("Promotion code", "  save10  "),
        update(),
        amount("status", "SAVE10 applied."),
      ],
    ],
    [
      "demo-103-gift-wrapping",
      "DEMO-103: Gift wrapping can be added and removed",
      [
        go(),
        step("check", target("label", "Add gift wrapping for ₹75")),
        update(),
        amount("giftWrapping", "₹75.00"),
        amount("total", "₹625.00"),
        step("uncheck", target("label", "Add gift wrapping for ₹75")),
        update(),
        amount("giftWrapping", "₹0.00"),
        amount("total", "₹550.00"),
      ],
    ],
    [
      "demo-103-gift-wrapping",
      "DEMO-103: Promotion leaves wrapping fee unchanged",
      [
        go(),
        step("check", target("label", "Add gift wrapping for ₹75")),
        fill("Promotion code", "SAVE10"),
        update(),
        amount("discount", "₹50.00"),
        amount("giftWrapping", "₹75.00"),
        amount("total", "₹575.00"),
      ],
    ],
  ];
  const cases: any[] = [];
  for (const [group, title, steps] of specifications) {
    let current = detail.cases.find((c: any) => c.title === title);
    if (!current) {
      const definition: TestCase = {
        title,
        module: "Checkout",
        priority: "high",
        roleRef: null,
        requirementIds: [
          requirements[
            group === "demo-103-gift-wrapping"
              ? "Gift wrapping feature proposal"
              : "Checkout rules"
          ],
        ],
        preconditions: `Fresh Parcel page. Scope: ${group}. No real orders or payments.`,
        steps,
        cleanup: [],
        retrySafe: true,
      };
      const saved = await client.request(
        "POST",
        `/projects/${project.id}/cases`,
        definition,
        201,
      );
      current = (await client.request("GET", `/cases/${saved.id}/history`))[0];
    }
    if (group === "baseline")
      await client.request("POST", `/case-versions/${current.id}/approvals`, {
        hash: current.hash,
      });
    cases.push({ group, id: current.id, hash: current.hash, title });
  }
  const environments = [];
  for (const [branch, name, port] of [
    ["main", "Development", 4180],
    ["demo-101-free-delivery-boundary", "DEMO-101 correct bug fix", 4181],
    ["demo-102-promo-normalization", "DEMO-102 intentional regression", 4182],
    ["demo-103-gift-wrapping", "DEMO-103 gift wrapping", 4183],
  ] as const) {
    const baseUrl = `http://127.0.0.1:${port}`;
    const existing = detail.environments.find(
      (e: any) => new URL(e.base_url).origin === baseUrl,
    );
    const id =
      existing?.id ||
      (
        await client.request(
          "POST",
          `/projects/${project.id}/environments`,
          { name, baseUrl },
          201,
        )
      ).id;
    environments.push({ branch, name, id, baseUrl });
  }
  await client.request(
    "POST",
    `/projects/${project.id}/environments`,
    { name: "Invalid metadata target", baseUrl: "http://169.254.169.254" },
    422,
  );
  const discovery = await client.request(
    "POST",
    `/environments/${environments[0].id}/discoveries`,
    { paths: ["/"], maxPages: 1 },
    202,
  );
  const snapshot = await waitFor(
    async () => {
      detail = await client.request("GET", "/projects/" + project.id);
      return detail.discoveries.find((d: any) => d.id === discovery.id);
    },
    (d: any) => ["completed", "errored"].includes(d?.state),
  );
  assert.equal(snapshot.state, "completed", snapshot.error);
  assert.equal(snapshot.pages.length, 1);
  await writeFile(
    output,
    JSON.stringify(
      { projectId: project.id, repository, environments, cases },
      null,
      2,
    ),
  );
  console.log(
    `Connected Parcel: http://127.0.0.1:3000/#projects/${project.id}`,
  );
  console.log(
    "Four preview environments, seven approved baseline cases, four draft acceptance cases, and live discovery are ready.",
  );
}
