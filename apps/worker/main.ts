import "dotenv/config";
import { PgBoss } from "pg-boss";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { CronExpressionParser } from "cron-parser";
import { pool, tx, one, rows, type DB } from "../../packages/db/index.js";
import {
  audit,
  event,
  createRun,
  saveCase,
  settle,
  entitlement,
} from "../../packages/domain/service.js";
import { decrypt, hash, redact } from "../../packages/domain/security.js";
import { generate, verifyProvider } from "../../packages/ai/codex.js";
import {
  executeBrowser,
  demoFixture,
  cleanupFixture,
  cleanupOrphanRunners,
  runnerReady,
} from "../../packages/runner/dispatch.js";
import { verdict, plans } from "../../packages/contracts/index.js";
await mkdir(".local/artifacts", { recursive: true, mode: 0o700 });
const leader = await pool.connect();
if (
  !(await leader.query("select pg_try_advisory_lock(719032) locked")).rows[0]
    .locked
) {
  console.error("Another local dispatcher already holds the worker lease");
  process.exit(1);
}
leader.on("error", () => process.exit(1));
const boss = new PgBoss({
  connectionString: process.env.QUEUE_DATABASE_URL,
  max: 4,
});
boss.on("error", (e) => console.error("Queue:", e.message));
await boss.start();
for (const name of ["regression", "discovery", "generation"])
  await boss.createQueue(name, { retryLimit: 0, expireInSeconds: 4200 });
const active = new Map<string, AbortController>();
const envLocks = new Map<string, Promise<void>>();
async function serialEnv<T>(id: string, fn: () => Promise<T>) {
  const prev = envLocks.get(id) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => (release = r));
  envLocks.set(id, current);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (envLocks.get(id) === current) envLocks.delete(id);
  }
}
const orgs = async () =>
  await tx(undefined, (db) => rows(db, "select id from organizations"));
async function recover() {
  for (const org of await orgs())
    await tx(org.id, async (db) => {
      const staleFixtures = await rows(
        db,
        "select a.id from attempts a join run_cases c on c.id=a.run_case_id join runs r on r.id=c.run_id join environments e on e.id=r.environment_id where a.state='running' and e.base_url=$1 union all select d.id from discoveries d join environments e on e.id=d.environment_id where d.state='running' and e.base_url=$1",
        [process.env.DEMO_ORIGIN],
      );
      for (const fixture of staleFixtures)
        await cleanupFixture(fixture.id).catch(() => {});
      const interrupted = await rows(
        db,
        "select * from runs where state in ('preparing','running','cancelling')",
      );
      for (const r of interrupted) {
        await db.query(
          "update runs set state='errored',verdict='inconclusive',error='Dispatcher restarted. Interrupted browser writes are not automatically retried.',finished_at=now() where id=$1",
          [r.id],
        );
        await db.query(
          "update run_cases set state='completed',outcome='errored' where run_id=$1 and state<>'completed'",
          [r.id],
        );
        await db.query(
          "update attempts set state='errored',cleanup_ok=false,error='Worker interrupted',finished_at=now() where run_case_id in(select id from run_cases where run_id=$1) and state='running'",
          [r.id],
        );
        await db.query("delete from reservations where reference_id=$1", [
          r.id,
        ]);
        await event(db, org.id, r.id, "run.interrupted", {});
      }
      await db.query(
        "update discoveries set state='errored',error='Worker interrupted; start a new discovery' where state='running'",
      );
      await db.query(
        "update ai_requests set state='errored',error='Worker interrupted; start a new generation' where state='running'",
      );
      await db.query(
        "delete from reservations where reference_id in(select id from discoveries where state='errored')",
      );
      await db.query(
        "update outbox set id=gen_random_uuid(),delivered_at=null where resource_id in(select id from runs where state='queued' union all select id from discoveries where state='queued' union all select id from ai_requests where state='queued')",
      );
      await db.query(
        "delete from reservations where metric='aiRequests' and reference_id in(select id from ai_requests where state='errored')",
      );
    });
}
await cleanupOrphanRunners().catch(() =>
  console.warn("Browser engine unavailable during startup cleanup"),
);
await recover();
async function credential(
  org: string,
  environment: string,
  name: string | null,
) {
  if (!name) return null;
  return tx(org, async (db) => {
    const s = await one(
      db,
      "select payload from secret_refs where environment_id=$1 and name=$2",
      [environment, name],
    );
    if (!s) throw Error("Login role is not configured in this environment");
    return decrypt(s.payload);
  });
}
async function build(base: string) {
  if (new URL(base).origin !== process.env.DEMO_ORIGIN) return null;
  try {
    const r = await fetch(process.env.DEMO_ORIGIN + "/__build", {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    return (await r.json()) as any;
  } catch {
    return null;
  }
}
async function runRegression(org: string, id: string) {
  const initial = await tx(org, (db) =>
    one(db, "select * from runs where id=$1", [id]),
  );
  if (!initial || !["queued", "cancelling"].includes(initial.state)) return;
  await serialEnv(initial.environment_id, async () => {
    const latest = await tx(org, (db) =>
      one(db, "select state from runs where id=$1", [id]),
    );
    if (!latest || !["queued", "cancelling"].includes(latest.state)) return;
    const ctrl = new AbortController();
    active.set(id, ctrl);
    const deadline = setTimeout(() => ctrl.abort(), 60 * 60000);
    let minutes = 0;
    let overallError: string | null = null;
    try {
      const r = await tx(org, async (db) => {
        const row = await one(
          db,
          "update runs set state='preparing',started_at=now(),heartbeat_at=now() where id=$1 and state='queued' returning *",
          [id],
        );
        if (!row) return null;
        await entitlement(db, org);
        const member = await one(
          db,
          "select 1 from memberships where org_id=$1 and user_id=$2 and active and role in ('owner','maintainer')",
          [org, row.actor_id],
        );
        if (!member) throw Error("Run owner no longer has test permissions");
        await event(db, org, id, "run.preparing", {});
        return row;
      });
      if (!r) {
        ctrl.abort();
        return;
      }
      const manifest = r.manifest;
      const before = await build(manifest.environment.baseUrl);
      if (manifest.expectedBuild && before?.id !== manifest.expectedBuild)
        throw Error("The target build does not match the selected build");
      await tx(org, async (db) => {
        await db.query(
          "update runs set state='running',build_before=$2 where id=$1 and state='preparing'",
          [id, JSON.stringify(before)],
        );
        await event(db, org, id, "run.running", {
          cases: manifest.cases.length,
        });
      });
      const cases = await tx(org, (db) =>
        rows(db, "select * from run_cases where run_id=$1 order by ordinal", [
          id,
        ]),
      );
      for (const rc of cases) {
        if (ctrl.signal.aborted) break;
        const snapshot = manifest.cases.find(
          (c: any) => c.id === rc.version_id,
        );
        const current = await tx(org, (db) =>
          one(
            db,
            "select v.status,c.archived,c.current_version,v.version from case_versions v join cases c on c.id=v.case_id where v.id=$1",
            [snapshot.id],
          ),
        );
        if (
          current?.status !== "approved" ||
          current.archived ||
          current.current_version !== current.version
        ) {
          await tx(org, (db) =>
            db.query(
              "update run_cases set state='completed',outcome='blocked' where id=$1",
              [rc.id],
            ),
          );
          continue;
        }
        const login = await credential(
          org,
          r.environment_id,
          snapshot.definition.roleRef,
        );
        let outcome = "errored";
        for (
          let attempt = 1;
          attempt <= (manifest.retry && snapshot.definition.retrySafe ? 2 : 1);
          attempt++
        ) {
          if (ctrl.signal.aborted) break;
          const aid = randomUUID();
          let fixtureId: string | null = null;
          let result: any;
          await tx(org, async (db) => {
            await db.query("update run_cases set state='running' where id=$1", [
              rc.id,
            ]);
            await db.query(
              "insert into attempts(id,org_id,run_case_id,number,state) values($1,$2,$3,$4,'running')",
              [aid, org, rc.id, attempt],
            );
            await event(db, org, id, "case.started", {
              runCaseId: rc.id,
              title: rc.title,
              attempt,
            });
          });
          try {
            if (
              new URL(manifest.environment.baseUrl).origin ===
              process.env.DEMO_ORIGIN
            )
              fixtureId = await demoFixture(aid);
            result = await executeBrowser(
              {
                kind: "case",
                baseUrl: manifest.environment.baseUrl,
                origins: manifest.environment.origins,
                definition: snapshot.definition,
                login,
                fixtureId,
                trace: manifest.trace,
              },
              ctrl.signal,
            );
          } catch (e) {
            result = {
              outcome: ctrl.signal.aborted ? "cancelled" : "errored",
              error: redact((e as Error).message),
              durationMs: 0,
              steps: [],
              assertions: 0,
              cleanupOK: false,
              evidence: [],
            };
          } finally {
            if (fixtureId)
              try {
                await cleanupFixture(fixtureId);
              } catch {
                if (result) result.cleanupOK = false;
              }
          }
          minutes += result.durationMs / 60000;
          outcome = result.outcome;
          if (!result.cleanupOK) outcome = "errored";
          const artifacts: any[] = [];
          for (const item of result.evidence || []) {
            if (!["trace", "screenshot"].includes(item.kind)) continue;
            const buf = Buffer.from(item.data, "base64");
            if (buf.length > 10 * 1024 * 1024) {
              outcome = "errored";
              continue;
            }
            const artifactId = randomUUID(),
              key = artifactId + (item.kind === "trace" ? ".zip" : ".png");
            await writeFile(".local/artifacts/" + key, buf, { mode: 0o600 });
            artifacts.push({
              id: artifactId,
              key,
              kind: item.kind,
              bytes: buf.length,
              sha: createHash("sha256").update(buf).digest("hex"),
            });
          }
          await tx(org, async (db) => {
            const subscription = await one(
              db,
              "select plan from subscriptions where org_id=$1 for update",
              [org],
            );
            const stored = await one(
              db,
              "select coalesce(sum(bytes),0) n from artifacts where deleted_at is null",
            );
            if (
              Number(stored.n) + artifacts.reduce((n, a) => n + a.bytes, 0) >
              plans[subscription.plan as keyof typeof plans].storageBytes
            ) {
              for (const a of artifacts)
                await unlink(".local/artifacts/" + a.key);
              artifacts.length = 0;
              outcome = "errored";
              result.outcome = "errored";
              result.error =
                "Evidence storage allowance reached. Remove expired evidence or change the demo plan.";
            }
            await db.query(
              "update attempts set state=$1,steps=$2,error=$3,duration_ms=$4,cleanup_ok=$5,assertions=$6,browser_version=$7,finished_at=now() where id=$8",
              [
                result.outcome,
                JSON.stringify(result.steps),
                result.error || null,
                result.durationMs,
                result.cleanupOK,
                result.assertions,
                result.browserVersion || null,
                aid,
              ],
            );
            for (const a of artifacts)
              await db.query(
                "insert into artifacts(id,org_id,attempt_id,kind,storage_key,bytes,sha256) values($1,$2,$3,$4,$5,$6,$7)",
                [a.id, org, aid, a.kind, a.key, a.bytes, a.sha],
              );
            await db.query(
              "insert into usage_ledger(org_id,event_key,metric,amount,reference_id) values($1,$2,'storageBytes',$3,$4) on conflict do nothing",
              [
                org,
                `artifact:${aid}`,
                artifacts.reduce((n, a) => n + a.bytes, 0),
                aid,
              ],
            );
            for (const s of result.steps)
              await event(db, org, id, "step.finished", {
                runCaseId: rc.id,
                attempt,
                ...s,
              });
          });
          if (outcome === "passed") {
            if (attempt > 1) outcome = "flaky";
            break;
          }
          if (outcome !== "failed") break;
        }
        if (ctrl.signal.aborted) outcome = "cancelled";
        await tx(org, async (db) => {
          await db.query(
            "update run_cases set state='completed',outcome=$1 where id=$2",
            [outcome, rc.id],
          );
          await event(db, org, id, "case.finished", {
            runCaseId: rc.id,
            outcome,
          });
        });
      }
      const after = await build(manifest.environment.baseUrl);
      const buildOK =
        before && after ? before.id === after.id : !manifest.expectedBuild;
      await tx(org, (db) =>
        db.query("update runs set build_after=$2,build_status=$3 where id=$1", [
          id,
          JSON.stringify(after),
          before && after ? (buildOK ? "verified" : "changed") : "unverified",
        ]),
      );
      if (!buildOK) overallError = "Target build changed during execution";
    } catch (e) {
      overallError = redact((e as Error).message);
    } finally {
      clearTimeout(deadline);
      active.delete(id);
      await tx(org, async (db) => {
        const cancelled =
          ctrl.signal.aborted ||
          (await one(db, "select state from runs where id=$1", [id]))?.state ===
            "cancelling";
        await db.query(
          "update run_cases set state='completed',outcome=$1 where run_id=$2 and state<>'completed'",
          [cancelled ? "cancelled" : "errored", id],
        );
        const outcomes = await rows(
          db,
          "select outcome from run_cases where run_id=$1",
          [id],
        );
        const finalVerdict = verdict(
          outcomes.map((c) => c.outcome),
          !cancelled && !overallError,
        );
        const state = cancelled
          ? "cancelled"
          : overallError
            ? "errored"
            : "completed";
        await db.query(
          "update runs set state=$1,verdict=$2,error=$3,finished_at=now() where id=$4",
          [state, finalVerdict, overallError, id],
        );
        await settle(db, org, id, "browserMinutes", minutes);
        await event(db, org, id, "run.finished", {
          state,
          verdict: finalVerdict,
        });
      });
    }
  });
}
async function discover(org: string, id: string) {
  const d = await tx(org, async (db) => {
    const row = await one(
      db,
      "update discoveries set state='running' where id=$1 and state='queued' returning *",
      [id],
    );
    if (!row) return null;
    row.env = await one(db, "select * from environments where id=$1", [
      row.environment_id,
    ]);
    return row;
  });
  if (!d) return;
  await serialEnv(d.environment_id, async () => {
    let fixtureId: string | null = null;
    const started = Date.now();
    try {
      await tx(org, (db) => entitlement(db, org));
      const e = d.env,
        login = await credential(org, e.id, d.limits.roleRef);
      if (new URL(e.base_url).origin === process.env.DEMO_ORIGIN)
        fixtureId = await demoFixture(id);
      const r = await executeBrowser({
        kind: "discover",
        baseUrl: e.base_url,
        origins: [new URL(e.base_url).origin, ...e.allowed_origins],
        login,
        fixtureId,
        ...d.limits,
      });
      if (!r.pages) throw Error(r.error || "Discovery failed");
      await tx(org, (db) =>
        db.query(
          "update discoveries set state='completed',pages=$1,finished_at=now() where id=$2",
          [
            JSON.stringify(
              r.pages.map((p: any) => ({ ...p, text: redact(p.text) })),
            ),
            id,
          ],
        ),
      );
    } catch (e) {
      await tx(org, (db) =>
        db.query(
          "update discoveries set state='errored',error=$1,finished_at=now() where id=$2",
          [redact((e as Error).message), id],
        ),
      );
    } finally {
      if (fixtureId) await cleanupFixture(fixtureId).catch(() => {});
      await tx(org, (db) =>
        settle(db, org, id, "browserMinutes", (Date.now() - started) / 60000),
      );
    }
  });
}
async function generation(org: string, id: string) {
  const request = await tx(org, (db) =>
    one(
      db,
      "update ai_requests set state='running' where id=$1 and state='queued' returning *",
      [id],
    ),
  );
  if (!request) return;
  try {
    await tx(org, (db) => entitlement(db, org));
    let verified = false;
    try {
      const r = JSON.parse(await readFile(".local/ai-readiness.json", "utf8"));
      verified =
        r.data?.ready === true &&
        r.model === (process.env.CODEX_MODEL || "gpt-5.5") &&
        r.policy?.allToolCallsRejected === true &&
        Date.now() - Date.parse(r.verifiedAt) < 24 * 60 * 60 * 1000;
    } catch {}
    if (!verified) {
      const r = await verifyProvider();
      await writeFile(".local/ai-readiness.json", JSON.stringify(r), {
        mode: 0o600,
      });
    }
    const result = await generate(request.context);
    await tx(org, async (db) => {
      const ids = [];
      for (const c of result.data.cases)
        ids.push(
          (await saveCase(db, org, request.project_id, c, "ai")).versionId,
        );
      await db.query(
        "update ai_requests set state='completed',model=$1,usage=$2,result_ids=$3,questions=$4,finished_at=now() where id=$5",
        [
          result.model,
          JSON.stringify(result.usage),
          JSON.stringify(ids),
          JSON.stringify(result.data.questions),
          id,
        ],
      );
      await settle(db, org, id, "aiRequests", 1);
    });
  } catch (e) {
    await tx(org, async (db) => {
      await db.query(
        "update ai_requests set state='errored',error=$1,finished_at=now() where id=$2",
        [redact((e as Error).message), id],
      );
      await settle(db, org, id, "aiRequests", 1);
    });
  }
}
await boss.work<any>(
  "regression",
  { localConcurrency: 2, batchSize: 1, pollingIntervalSeconds: 1 },
  async (jobs) => {
    for (const j of jobs) await runRegression(j.data.org, j.data.id);
  },
);
await boss.work<any>(
  "discovery",
  { localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: 1 },
  async (jobs) => {
    for (const j of jobs) await discover(j.data.org, j.data.id);
  },
);
await boss.work<any>(
  "generation",
  { localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: 1 },
  async (jobs) => {
    for (const j of jobs) await generation(j.data.org, j.data.id);
  },
);
let ticking = false;
let lastRetention = 0;
let browserReady = false,
  lastRunnerCheck = 0;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    if (Date.now() - lastRunnerCheck > 30000) {
      browserReady = await runnerReady();
      lastRunnerCheck = Date.now();
    }
    for (const org of await orgs()) {
      if (Date.now() - lastRetention > 60000)
        await tx(org.id, async (db) => {
          const expired = await rows(
            db,
            "select id,storage_key from artifacts where expires_at<=now() and deleted_at is null limit 100",
          );
          for (const a of expired) {
            await unlink(".local/artifacts/" + a.storage_key).catch((e) => {
              if (e.code !== "ENOENT") throw e;
            });
            await db.query(
              "update artifacts set deleted_at=now() where id=$1",
              [a.id],
            );
          }
        });
      const pending = await tx(org.id, (db) =>
        rows(
          db,
          "select * from outbox where delivered_at is null order by created_at limit 50",
        ),
      );
      for (const o of pending) {
        await boss.send(
          o.kind,
          { org: org.id, id: o.resource_id },
          { id: o.id, retryLimit: 0, expireInSeconds: 4200 },
        );
        await tx(org.id, (db) =>
          db.query("update outbox set delivered_at=now() where id=$1", [o.id]),
        );
      }
      await tx(org.id, async (db) => {
        const cancelling = await rows(
          db,
          "select id from runs where state='cancelling'",
        );
        for (const r of cancelling) {
          const controller = active.get(r.id);
          if (controller) controller.abort();
          else {
            await db.query(
              "update runs set state='cancelled',verdict='inconclusive',finished_at=now() where id=$1",
              [r.id],
            );
            await db.query(
              "update run_cases set state='completed',outcome='cancelled' where run_id=$1 and state<>'completed'",
              [r.id],
            );
            await settle(db, org.id, r.id, "browserMinutes", 0);
            await event(db, org.id, r.id, "run.finished", {
              state: "cancelled",
              verdict: "inconclusive",
            });
          }
        }
        await db.query(
          "update runs set heartbeat_at=now() where state in ('preparing','running')",
        );
        const due = await rows(
          db,
          "select * from schedules where enabled and next_fire<=now() for update skip locked",
        );
        for (const s of due) {
          const scheduled = s.next_fire;
          const next = CronExpressionParser.parse(s.cron, { tz: s.timezone })
            .next()
            .toDate();
          await db.query("update schedules set next_fire=$1 where id=$2", [
            next,
            s.id,
          ]);
          const fid = randomUUID();
          const inserted = await one(
            db,
            "insert into schedule_fires(id,org_id,schedule_id,scheduled_at,state) values($1,$2,$3,$4,'pending') on conflict do nothing returning id",
            [fid, org.id, s.id, scheduled],
          );
          if (!inserted) continue;
          let reason: string | undefined;
          const member = await one(
            db,
            "select 1 from memberships where org_id=$1 and user_id=$2 and active and role in ('owner','maintainer')",
            [org.id, s.actor_id],
          );
          if (!member) reason = "Schedule owner lacks permission";
          if (Date.now() - Date.parse(scheduled) > 60000)
            reason = "Missed while the local app was unavailable";
          const overlap = await one(
            db,
            "select 1 from runs where environment_id=$1 and state in ('queued','preparing','running','cancelling')",
            [s.environment_id],
          );
          if (overlap)
            reason = "An execution is already active in this environment";
          if (reason) {
            await db.query(
              "update schedule_fires set state='skipped',reason=$1 where id=$2",
              [reason, fid],
            );
            continue;
          }
          await db.query("SAVEPOINT schedule_run");
          try {
            const run = await createRun(
              db,
              org.id,
              s.actor_id,
              {
                projectId: s.project_id,
                environmentId: s.environment_id,
                suiteId: s.suite_id,
                retry: true,
              },
              `schedule:${s.id}:${new Date(scheduled).toISOString()}`,
              "schedule",
            );
            await db.query(
              "update schedule_fires set state='queued',run_id=$1 where id=$2",
              [run.id, fid],
            );
            await db.query("RELEASE SAVEPOINT schedule_run");
          } catch (e) {
            await db.query("ROLLBACK TO SAVEPOINT schedule_run");
            await db.query(
              "update schedule_fires set state='skipped',reason=$1 where id=$2",
              [(e as Error).message, fid],
            );
          }
        }
      });
    }
    if (Date.now() - lastRetention > 60000) lastRetention = Date.now();
    await writeFile(
      ".local/worker.json",
      JSON.stringify({
        at: new Date().toISOString(),
        pid: process.pid,
        activeRuns: active.size,
        browserReady,
        browserSlots: 2,
        aiSlots: 1,
      }),
      { mode: 0o600 },
    );
  } catch (e) {
    console.error("Dispatcher tick:", (e as Error).message);
  } finally {
    ticking = false;
  }
}
const interval = setInterval(tick, 2000);
await tick();
console.log(
  "Dispatcher ready: two browser slots, one AI slot, durable schedules",
);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    clearInterval(interval);
    for (const ctrl of active.values()) ctrl.abort();
    await boss.stop({ graceful: true, timeout: 30000 });
    await leader.query("select pg_advisory_unlock(719032)");
    leader.release();
    await pool.end();
    process.exit(0);
  });
