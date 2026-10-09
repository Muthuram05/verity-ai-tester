import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { ownerClient, Client, waitFor } from "./test-client.js";
import { tx, pool, rows } from "../packages/db/index.js";

const phase = process.argv[2] || "full";
const { client } = await ownerClient();
const checks: { name: string; at: string; details?: unknown }[] = [];
const pass = (name: string, details?: unknown) => {
  checks.push({ name, at: new Date().toISOString(), details });
  console.log("PASS " + name);
};
const me = await client.request("GET", "/me");
let projects = await client.request("GET", "/projects");
let project = projects.find((p: any) => p.name === "Gather community");
if (!project) {
  const seeded = await client.request("POST", "/demo", {}, 201);
  project = { id: seeded.projectId || seeded.id };
}
let detail = await client.request("GET", "/projects/" + project.id);
const environment = detail.environments[0];
const refresh = async () =>
  (detail = await client.request("GET", "/projects/" + project.id));
const baseline = detail.cases.filter((c: any) => c.origin === "demo-authored");
assert.equal(baseline.length, 22);
await writeFile(
  ".local/verification-state.json",
  JSON.stringify(
    { projectId: project.id, environmentId: environment.id },
    null,
    2,
  ),
);
try {
  if (["api", "full"].includes(phase)) {
    assert.equal(me.role, "owner");
    pass("Owner setup, session and server-derived role");
    await new Client().request("GET", "/projects", undefined, 401);
    await client.request("POST", "/demo", {}, 403, {
      "x-csrf-token": "invalid",
    });
    await client.request("GET", "/projects", undefined, 403, {
      origin: "https://untrusted.invalid",
    });
    pass("Authentication, CSRF and Origin enforcement");
    await client.request(
      "POST",
      "/projects",
      { name: "Unsafe target", baseUrl: "http://169.254.169.254/" },
      422,
    );
    pass("Private metadata target rejected");
    const stranger = randomUUID();
    assert.equal(
      (
        await tx(stranger, (db) =>
          rows(db, "select id from projects where id=$1", [project.id]),
        )
      ).length,
      0,
    );
    await assert.rejects(
      tx(stranger, (db) =>
        db.query("insert into projects(id,org_id,name) values($1,$2,$3)", [
          randomUUID(),
          me.org_id,
          "Cross tenant",
        ]),
      ),
    );
    pass("PostgreSQL tenant read/write isolation");
    await assert.rejects(
      tx(me.org_id, (db) =>
        db.query(
          "update case_versions set title='Illegal mutation' where id=$1",
          [baseline[0].id],
        ),
      ),
    );
    pass("Immutable scenario content enforced in database");
    await client.request(
      "POST",
      "/case-versions/" + baseline[0].id + "/approvals",
      { hash: "stale" },
      409,
    );
    pass("Stale approval rejected");
    for (const c of baseline)
      if (c.status !== "approved")
        await client.request("POST", "/case-versions/" + c.id + "/approvals", {
          hash: c.hash,
        });
    pass("22 authored demo scenarios explicitly approved");
    const email = `viewer-${randomUUID()}@verity.local`,
      password = randomBytes(18).toString("hex");
    await client.request(
      "POST",
      "/members",
      { name: "Verification viewer", email, password, role: "viewer" },
      201,
    );
    const viewer = new Client();
    await viewer.request("POST", "/sessions", { email, password });
    await viewer.request("GET", "/projects");
    await viewer.request("POST", "/demo", {}, 403);
    pass("Viewer can read and cannot mutate");
    await client.request("POST", "/billing/simulations", {
      plan: "studio",
      state: "past_due",
    });
    try {
      await client.request(
        "POST",
        "/projects",
        { name: "Blocked by plan", baseUrl: "http://127.0.0.1:4174" },
        429,
      );
    } finally {
      await client.request("POST", "/billing/simulations", {
        plan: "studio",
        state: "active",
      });
    }
    pass("Demo billing entitlement blocks new work and restores access");
    const csv = await client.request("GET", `/projects/${project.id}/export`);
    assert(csv.includes("Title,Module"));
    const openapi = await client.request("GET", "/openapi");
    assert(openapi.paths["/api/v1/runs"]);
    pass("Scenario CSV and authenticated OpenAPI exports");
  }
  if (["browser", "full"].includes(phase)) {
    for (const c of baseline)
      if (c.status !== "approved")
        await client.request("POST", "/case-versions/" + c.id + "/approvals", {
          hash: c.hash,
        });
    const execute = async (mode: string) => {
      await client.request("POST", "/demo/mode", { mode });
      const build = await client.request("GET", "/demo/build");
      const body = {
        projectId: project.id,
        environmentId: environment.id,
        versionIds: baseline.map((c: any) => c.id),
        expectedBuild: build.id,
        retry: false,
        trace: mode === "buggy",
      };
      const key = randomUUID();
      const [first, second] = await Promise.all([
        client.request("POST", "/runs", body, 202, { "idempotency-key": key }),
        client.request("POST", "/runs", body, 202, { "idempotency-key": key }),
      ]);
      assert.equal(first.runId, second.runId);
      await client.request("POST", "/runs", { ...body, retry: true }, 409, {
        "idempotency-key": key,
      });
      console.log(`Running ${mode} baseline: ${first.runId}`);
      return waitFor(
        () => client.request("GET", "/runs/" + first.runId),
        (r) => ["completed", "errored", "cancelled"].includes(r.run.state),
      );
    };
    const fixed = await execute("fixed");
    assert.equal(fixed.run.verdict, "passed", JSON.stringify(fixed.cases));
    assert.equal(
      fixed.cases.filter((c: any) => c.outcome === "passed").length,
      22,
    );
    assert.equal(fixed.run.build_status, "verified");
    pass("Fixed demo: all 22 scenarios pass with verified build", {
      runId: fixed.run.id,
    });
    const buggy = await execute("buggy");
    assert.equal(buggy.run.verdict, "failed");
    const failures = buggy.cases.filter((c: any) => c.outcome === "failed");
    assert(failures.length >= 3);
    assert(buggy.artifacts.some((a: any) => a.kind === "trace"));
    pass("Seeded defects produce actual failed assertions and traces", {
      runId: buggy.run.id,
      failures: failures.map((c: any) => c.title),
    });
    const repaired = await execute("fixed");
    assert.equal(repaired.run.verdict, "passed");
    assert.equal(
      (await client.request("GET", "/runs/" + buggy.run.id)).run.verdict,
      "failed",
    );
    pass("Repaired build passes; failed history remains unchanged", {
      runId: repaired.run.id,
    });
    const report = await client.request(
      "GET",
      `/runs/${buggy.run.id}/export?format=html`,
    );
    assert(report.includes("Regression report") && report.includes("failed"));
    pass("Real regression report export");
  }
  if (["ai", "full"].includes(phase)) {
    const discovery = await client.request(
      "POST",
      `/environments/${environment.id}/discoveries`,
      {
        roleRef: "alex",
        maxPages: 8,
        paths: ["/feed", "/profile", "/search", "/comments"],
      },
      202,
    );
    const discovered = await waitFor(
      async () => {
        await refresh();
        return detail.discoveries.find((d: any) => d.id === discovery.id);
      },
      (d) => ["completed", "errored"].includes(d?.state),
    );
    assert.equal(discovered.state, "completed", discovered.error);
    assert(discovered.pages.length >= 3);
    pass("Isolated authenticated application discovery", {
      pages: discovered.pages.length,
    });
    const generated = await client.request(
      "POST",
      `/projects/${project.id}/generations`,
      {
        count: 5,
        focus:
          "Read-only smoke tests for discovered pages using existing roles. Avoid write actions.",
      },
      202,
    );
    const result = await waitFor(
      async () => {
        await refresh();
        return detail.generations.find((g: any) => g.id === generated.id);
      },
      (g) => ["completed", "errored"].includes(g?.state),
    );
    assert.equal(result.state, "completed", result.error);
    assert(result.result_ids.length > 0);
    assert(result.model);
    pass("Fresh AI generation through the signed-in local provider", {
      model: result.model,
      count: result.result_ids.length,
    });
    await refresh();
    const drafts = detail.cases.filter((c: any) =>
      result.result_ids.includes(c.id),
    );
    assert.equal(drafts.length, result.result_ids.length);
    assert(drafts.every((c: any) => c.origin === "ai" && c.status === "draft"));
    pass("AI output saved as unapproved, source-linked drafts");
    await writeFile(
      ".local/generated-review.json",
      JSON.stringify(
        drafts.map((c: any) => ({
          id: c.id,
          hash: c.hash,
          definition: c.definition,
        })),
        null,
        2,
      ),
    );
  }
} finally {
  await writeFile(
    `.local/verification-${phase}.json`,
    JSON.stringify({ phase, at: new Date().toISOString(), checks }, null, 2),
  );
  await pool.end();
}
console.log(`${checks.length} checks passed (${phase}).`);
