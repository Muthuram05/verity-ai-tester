import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ownerClient } from "./test-client.js";
import { pool, tx, one } from "../packages/db/index.js";
import { demoFixture } from "../packages/runner/dispatch.js";
const { client } = await ownerClient();
try {
  if (process.argv[2] === "prepare") {
    const worker = JSON.parse(await readFile(".local/worker.json", "utf8"));
    const command = await promisify(execFile)("ps", [
      "-p",
      String(worker.pid),
      "-o",
      "command=",
    ]);
    assert(
      command.stdout.includes("apps/worker/main.ts"),
      "Refusing to signal an unrelated process",
    );
    const me = await client.request("GET", "/me");
    const state = JSON.parse(
      await readFile(".local/verification-state.json", "utf8"),
    );
    const detail = await client.request("GET", "/projects/" + state.projectId);
    process.kill(worker.pid, "SIGSTOP");
    let killed = false;
    try {
      const queued = await client.request(
        "POST",
        "/runs",
        {
          projectId: state.projectId,
          environmentId: state.environmentId,
          versionIds: [
            detail.cases.find((c: any) => c.status === "approved").id,
          ],
        },
        202,
        { "idempotency-key": randomUUID() },
      );
      const attemptId = randomUUID();
      assert.equal(await demoFixture(attemptId), attemptId);
      const liveFixture = await fetch(process.env.DEMO_ORIGIN + "/api/me", {
        headers: { "x-demo-fixture": attemptId },
      });
      assert.equal(
        liveFixture.status,
        401,
        "Fixture must exist before interruption",
      );
      await tx(me.org_id, async (db) => {
        const runCase = await one(
          db,
          "select id from run_cases where run_id=$1",
          [queued.runId],
        );
        await db.query(
          "update runs set state='running',started_at=now() where id=$1",
          [queued.runId],
        );
        await db.query("update run_cases set state='running' where id=$1", [
          runCase.id,
        ]);
        await db.query(
          "insert into attempts(id,org_id,run_case_id,number,state) values($1,$2,$3,1,'running')",
          [attemptId, me.org_id, runCase.id],
        );
      });
      await writeFile(
        ".local/recovery-probe.json",
        JSON.stringify({ runId: queued.runId, attemptId }, null, 2),
      );
      process.kill(worker.pid, "SIGKILL");
      killed = true;
      console.log(
        "Prepared an owned demo attempt and interrupted the local worker. Restart npm run dev, then run this script with verify.",
      );
    } finally {
      if (!killed) process.kill(worker.pid, "SIGCONT");
    }
  } else {
    const probe = JSON.parse(
      await readFile(".local/recovery-probe.json", "utf8"),
    );
    const result = await client.request("GET", "/runs/" + probe.runId);
    assert.equal(result.run.state, "errored");
    assert.equal(result.run.verdict, "inconclusive");
    assert(result.attempts.every((a: any) => a.state === "errored"));
    assert(result.events.some((e: any) => e.type === "run.interrupted"));
    const fixture = await fetch(process.env.DEMO_ORIGIN + "/api/me", {
      headers: { "x-demo-fixture": probe.attemptId },
    });
    assert.equal(fixture.status, 404);
    assert.equal((await fixture.json()).error, "Fixture expired");
    const me = await client.request("GET", "/me");
    const reservation = await tx(me.org_id, (db) =>
      one(db, "select 1 from reservations where reference_id=$1", [
        probe.runId,
      ]),
    );
    assert.equal(reservation, undefined);
    await writeFile(
      ".local/verification-recovery.json",
      JSON.stringify(
        {
          at: new Date().toISOString(),
          runId: probe.runId,
          interruptedWritesNotReplayed: true,
          verdict: "inconclusive",
          fixtureRemoved: true,
          reservationReleased: true,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS worker restart preserves inconclusive evidence, removes the demo fixture and releases its reservation",
    );
  }
} finally {
  await pool.end();
}
