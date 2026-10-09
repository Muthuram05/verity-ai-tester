import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ownerClient, waitFor } from "./test-client.js";
import { pool, tx, one } from "../packages/db/index.js";
import { reserve } from "../packages/domain/service.js";
const { client } = await ownerClient();
const me = await client.request("GET", "/me");
const { projectId, environmentId } = JSON.parse(
  await readFile(".local/verification-state.json", "utf8"),
);
const detail = await client.request("GET", "/projects/" + projectId);
const baseline = detail.cases.filter((c: any) => c.origin === "demo-authored");
const checks: string[] = [];
const pass = (name: string) => {
  checks.push(name);
  console.log("PASS " + name);
};
try {
  const source = await client.request(
    "POST",
    `/projects/${projectId}/requirements`,
    {
      title: "Verification source",
      body: "The profile page displays the current account name.",
    },
    201,
  );
  const definition = {
    ...baseline.find((c: any) => c.title === "Profile loads the account name")
      .definition,
    title: "Verification revision scenario",
    requirementIds: [source.id],
  };
  const created = await client.request(
    "POST",
    `/projects/${projectId}/cases`,
    definition,
    201,
  );
  let history = await client.request("GET", `/cases/${created.id}/history`);
  await client.request(
    "POST",
    `/case-versions/${created.versionId}/approvals`,
    { hash: history[0].hash },
  );
  await client.request(
    "POST",
    `/projects/${projectId}/requirements`,
    {
      title: "Verification source",
      body: "The profile page displays the current account name and biography.",
      previousId: source.id,
    },
    201,
  );
  await client.request(
    "POST",
    `/case-versions/${created.versionId}/approvals`,
    { hash: history[0].hash },
    409,
  );
  assert.equal(
    (await client.request("GET", `/cases/${created.id}/history`))[0].status,
    "needs_review",
  );
  const edited = await client.request("PATCH", `/cases/${created.id}`, {
    definition: { ...definition, title: "Verification revised scenario" },
    expectedVersion: 1,
  });
  await client.request(
    "PATCH",
    `/cases/${created.id}`,
    { definition, expectedVersion: 1 },
    409,
  );
  history = await client.request("GET", `/cases/${created.id}/history`);
  assert.equal(history.length, 2);
  assert.equal(history[1].definition.title, definition.title);
  assert.equal(history[0].status, "draft");
  await client.request("POST", `/cases/${created.id}/archive`, {
    archived: true,
  });
  pass(
    "Requirement revisions invalidate approvals; scenario history is immutable and edits detect conflicts",
  );

  const reservation = randomUUID();
  await client.request("POST", "/billing/simulations", {
    plan: "starter",
    state: "active",
  });
  try {
    await tx(me.org_id, async (db) => {
      const usage = await one(
        db,
        "select coalesce(sum(amount),0) n from usage_ledger where metric='browserMinutes' and created_at>=date_trunc('month',now())",
      );
      await reserve(
        db,
        me.org_id,
        reservation,
        "browserMinutes",
        Math.max(0, 119.9 - Number(usage.n)),
      );
    });
    await client.request(
      "POST",
      "/runs",
      { projectId, environmentId, versionIds: [baseline[0].id] },
      429,
      { "idempotency-key": randomUUID() },
    );
  } finally {
    await tx(me.org_id, (db) =>
      db.query("delete from reservations where reference_id=$1", [reservation]),
    );
    await client.request("POST", "/billing/simulations", {
      plan: "studio",
      state: "active",
    });
  }
  pass("Outstanding reservations prevent browser quota oversubscription");

  const repo = path.resolve(".local/impact-fixture-" + randomUUID());
  await mkdir(path.join(repo, "src/profile"), { recursive: true });
  await mkdir(path.join(repo, "src/shared"), { recursive: true });
  const exec = promisify(execFile);
  const git = (args: string[]) =>
    exec(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "user.name=Verity verification",
        "-c",
        "user.email=verification@example.test",
        ...args,
      ],
      { cwd: repo },
    );
  await git(["init"]);
  await writeFile(
    path.join(repo, "src/profile/view.ts"),
    "export const version=1;\n",
  );
  await git(["add", "."]);
  await git(["commit", "-m", "Initial verification fixture"]);
  await writeFile(
    path.join(repo, "src/profile/view.ts"),
    "export const version=2;\n",
  );
  await git(["add", "."]);
  await git(["commit", "-m", "Update profile fixture"]);
  await client.request("POST", `/projects/${projectId}/repository`, {
    path: repo,
    modulePaths: { Profile: "src/profile/" },
  });
  const mapped = await client.request(
    "POST",
    `/projects/${projectId}/changes`,
    { base: "HEAD~1", head: "HEAD" },
  );
  assert(mapped.selection.length > 0);
  assert(mapped.selection.every((c: any) => c.module === "Profile"));
  assert(mapped.files.includes("src/profile/view.ts"));
  pass(
    "Real local Git changes select scenarios using explicit module mappings",
  );
  await writeFile(
    path.join(repo, "src/shared/config.ts"),
    "export const setting=true;\n",
  );
  await git(["add", "."]);
  await git(["commit", "-m", "Update shared fixture"]);
  const full = await client.request("POST", `/projects/${projectId}/changes`, {
    base: "HEAD~1",
    head: "HEAD",
  });
  assert.deepEqual(
    full.selection.map((c: any) => c.id).sort(),
    detail.cases
      .filter((c: any) => c.status === "approved" && !c.archived)
      .map((c: any) => c.id)
      .sort(),
  );
  pass(
    "Shared or unmapped Git changes conservatively select the full approved suite",
  );

  const suite = await client.request(
    "POST",
    "/suites",
    {
      projectId,
      name: "Verification daily smoke",
      versionIds: [baseline[0].id],
    },
    201,
  );
  await assert.rejects(
    tx(me.org_id, (db) =>
      db.query("update suites set name='mutated' where id=$1", [suite.id]),
    ),
  );
  pass("Suite snapshots are immutable at the database layer");
  const schedule = await client.request(
    "POST",
    "/schedules",
    {
      projectId,
      environmentId,
      suiteId: suite.id,
      name: "Presentation smoke (paused)",
      cron: "0 9 * * *",
      timezone: "Asia/Kolkata",
    },
    201,
  );
  await client.request("PATCH", `/schedules/${schedule.id}`, {
    enabled: false,
  });
  await client.request(
    "POST",
    "/schedules",
    {
      projectId,
      environmentId,
      suiteId: suite.id,
      name: "Invalid schedule",
      cron: "bad",
      timezone: "not-a-timezone",
    },
    422,
  );
  pass("Schedule validation, persistence and pause");

  if (process.argv.includes("--runner")) {
    const queued = await client.request(
      "POST",
      "/runs",
      { projectId, environmentId, versionIds: baseline.map((c: any) => c.id) },
      202,
      { "idempotency-key": randomUUID() },
    );
    await client.request("POST", `/runs/${queued.runId}/cancellation`, {});
    const cancelled = await waitFor(
      () => client.request("GET", "/runs/" + queued.runId),
      (r) => ["cancelled", "errored", "completed"].includes(r.run.state),
    );
    assert.equal(cancelled.run.state, "cancelled");
    assert.equal(cancelled.run.verdict, "inconclusive");
    pass("Cancellation produces an inconclusive terminal result");
    await client.request("PATCH", `/schedules/${schedule.id}`, {
      enabled: true,
    });
    await tx(me.org_id, (db) =>
      db.query(
        "update schedules set next_fire=now()-interval '1 second' where id=$1",
        [schedule.id],
      ),
    );
    const fired = await waitFor(
      () => client.request("GET", "/schedules"),
      (r) =>
        r.fires.some((f: any) => f.schedule_id === schedule.id && f.run_id),
    );
    await client.request("PATCH", `/schedules/${schedule.id}`, {
      enabled: false,
    });
    const fire = fired.fires.find((f: any) => f.schedule_id === schedule.id);
    const scheduled = await waitFor(
      () => client.request("GET", "/runs/" + fire.run_id),
      (r) => ["completed", "errored", "cancelled"].includes(r.run.state),
    );
    assert.equal(scheduled.run.verdict, "passed");
    assert.equal(scheduled.run.trigger, "schedule");
    pass("Durable schedule fire executes a real approved browser scenario");
    await assert.rejects(
      tx(me.org_id, (db) =>
        db.query("update runs set manifest='{}' where id=$1", [fire.run_id]),
      ),
    );
    pass("Completed run manifests cannot be changed");
  }
} finally {
  await writeFile(
    ".local/verification-controls.json",
    JSON.stringify({ at: new Date().toISOString(), checks }, null, 2),
  );
  await pool.end();
}
