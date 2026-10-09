import { randomUUID } from "node:crypto";
import { type DB, one, rows } from "../db/index.js";
import { validateCase, plans, type TestCase } from "../contracts/index.js";
import { hash } from "./security.js";
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const need = (value: any, message = "Resource not found") => {
  if (!value) throw new AppError(404, "NOT_FOUND", message);
  return value;
};
export async function audit(
  db: DB,
  org: string,
  actor: string | null,
  type: string,
  id: string | null,
  details: unknown = {},
) {
  await db.query(
    "insert into audit_events(org_id,actor_id,type,resource_id,details) values($1,$2,$3,$4,$5)",
    [org, actor, type, id, JSON.stringify(details)],
  );
}
export async function outbox(db: DB, org: string, kind: string, id: string) {
  await db.query(
    "insert into outbox(id,org_id,kind,resource_id) values($1,$2,$3,$4) on conflict do nothing",
    [randomUUID(), org, kind, id],
  );
}
export async function event(
  db: DB,
  org: string,
  run: string,
  type: string,
  payload: unknown,
) {
  await db.query(
    "insert into run_events(org_id,run_id,type,payload) values($1,$2,$3,$4)",
    [org, run, type, JSON.stringify(payload)],
  );
}
export async function entitlement(db: DB, org: string) {
  const sub = need(
    await one(db, "select * from subscriptions where org_id=$1 for update", [
      org,
    ]),
  );
  if (
    sub.state === "cancel_scheduled" &&
    new Date(sub.period_end) < new Date()
  ) {
    sub.state = "cancelled";
    await db.query(
      "update subscriptions set state='cancelled' where org_id=$1",
      [org],
    );
  }
  if (!["trial", "active", "cancel_scheduled"].includes(sub.state))
    throw new AppError(
      429,
      "SUBSCRIPTION_INACTIVE",
      "This demo subscription does not permit new work. Update the plan in settings.",
    );
  return { ...sub, limits: plans[sub.plan as keyof typeof plans] };
}
export async function reserve(
  db: DB,
  org: string,
  id: string,
  metric: "aiRequests" | "browserMinutes",
  amount: number,
) {
  const sub = await entitlement(db, org);
  const used = await one(
    db,
    "select coalesce(sum(amount),0) as n from usage_ledger where metric=$1 and created_at>=date_trunc('month',now())",
    [metric],
  );
  const reserved = await one(
    db,
    "select coalesce(sum(amount),0) as n from reservations where metric=$1 and expires_at>now()",
    [metric],
  );
  if (Number(used.n) + Number(reserved.n) + amount > sub.limits[metric])
    throw new AppError(
      429,
      "QUOTA_EXCEEDED",
      `The ${metric} allowance cannot cover this operation.`,
    );
  await db.query(
    "insert into reservations(id,org_id,metric,amount,reference_id,expires_at) values($1,$2,$3,$4,$5,now()+interval '70 minutes')",
    [randomUUID(), org, metric, amount, id],
  );
}
export async function settle(
  db: DB,
  org: string,
  id: string,
  metric: string,
  amount: number,
) {
  await db.query(
    "insert into usage_ledger(org_id,event_key,metric,amount,reference_id) values($1,$2,$3,$4,$5) on conflict do nothing",
    [org, `settle:${id}`, metric, amount, id],
  );
  await db.query(
    "delete from reservations where reference_id=$1 and metric=$2",
    [id, metric],
  );
}
export async function saveCase(
  db: DB,
  org: string,
  project: string,
  input: unknown,
  origin: string,
  caseId?: string,
  expectedVersion?: number,
) {
  const c = validateCase(input);
  const existingSources = await rows(
    db,
    "select id from requirements where project_id=$1 and id=any($2::uuid[])",
    [project, c.requirementIds],
  );
  if (existingSources.length !== new Set(c.requirementIds).size)
    throw new AppError(
      422,
      "INVALID_SOURCE",
      "Every source must belong to this project",
    );
  let version = 1;
  const id = caseId || randomUUID();
  if (caseId) {
    const old = need(
      await one(
        db,
        "select * from cases where id=$1 and project_id=$2 for update",
        [id, project],
      ),
    );
    if (old.current_version !== expectedVersion)
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "This scenario changed. Reload it before editing.",
      );
    version = old.current_version + 1;
    await db.query("update cases set current_version=$1 where id=$2", [
      version,
      id,
    ]);
    await db.query(
      "update case_versions set status='superseded' where case_id=$1 and status='approved'",
      [id],
    );
  } else
    await db.query("insert into cases(id,org_id,project_id) values($1,$2,$3)", [
      id,
      org,
      project,
    ]);
  const v = randomUUID();
  await db.query(
    "insert into case_versions(id,org_id,case_id,version,title,module,priority,definition,source_ids,hash,origin) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      v,
      org,
      id,
      version,
      c.title,
      c.module,
      c.priority,
      JSON.stringify(c),
      JSON.stringify(c.requirementIds),
      hash(c),
      origin,
    ],
  );
  return { id, versionId: v, version };
}
export async function approve(
  db: DB,
  org: string,
  actor: string,
  versionId: string,
  expectedHash: string,
) {
  const c = need(
    await one(
      db,
      "select v.*,c.current_version,c.archived from case_versions v join cases c on c.id=v.case_id where v.id=$1 for update of v,c",
      [versionId],
    ),
  );
  if (c.hash !== expectedHash || c.version !== c.current_version || c.archived)
    throw new AppError(
      409,
      "STALE_VERSION",
      "Approve the current exact scenario version",
    );
  validateCase(c.definition);
  const staleSources = await rows(
    db,
    "select r.id from requirements r where r.id=any($1::uuid[]) and exists(select 1 from requirements newer where newer.requirement_key=r.requirement_key and newer.revision>r.revision)",
    [c.source_ids],
  );
  if (staleSources.length)
    throw new AppError(
      409,
      "STALE_REQUIREMENT",
      "Update this scenario to reference the current requirement revision before approving it",
    );
  await db.query(
    "update case_versions set status='approved',approved_by=$1,approved_at=now() where id=$2",
    [actor, versionId],
  );
  await audit(db, org, actor, "case.approved", versionId, { hash: c.hash });
}
export async function createRun(
  db: DB,
  org: string,
  actor: string,
  request: any,
  key: string,
  trigger = "manual",
) {
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    org + ":" + key,
  ]);
  const requestHash = hash(request);
  const old = await one(db, "select * from runs where idempotency_key=$1", [
    key,
  ]);
  if (old) {
    if (old.request_hash !== requestHash)
      throw new AppError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This request key was used with different data",
      );
    return old;
  }
  const env = need(
    await one(db, "select * from environments where id=$1 and project_id=$2", [
      request.environmentId,
      request.projectId,
    ]),
  );
  let ids = request.versionIds;
  let suite = null;
  if (request.suiteId) {
    suite = need(
      await one(db, "select * from suites where id=$1 and project_id=$2", [
        request.suiteId,
        request.projectId,
      ]),
    );
    ids = suite.version_ids;
  }
  const selected = await rows(
    db,
    `select v.*,c.project_id,c.archived,c.current_version from case_versions v join cases c on c.id=v.case_id where c.project_id=$1 and ${ids?.length ? "v.id=any($2::uuid[])" : "v.version=c.current_version and v.status='approved' and not c.archived"} order by v.created_at,v.id`,
    ids?.length ? [request.projectId, ids] : [request.projectId],
  );
  if (!selected.length)
    throw new AppError(
      422,
      "EMPTY_SUITE",
      "Approve at least one scenario before running regression",
    );
  if (selected.length > 100)
    throw new AppError(
      422,
      "SUITE_LIMIT",
      "A local run supports up to 100 cases",
    );
  if (ids && selected.length !== new Set(ids).size)
    throw new AppError(422, "MISSING_CASES", "Some selected cases are missing");
  for (const c of selected) {
    if (
      c.status !== "approved" ||
      c.archived ||
      c.version !== c.current_version ||
      hash(c.definition) !== c.hash
    )
      throw new AppError(
        409,
        "UNAPPROVED_CASE",
        "A selected scenario requires review",
      );
    validateCase(c.definition);
  }
  const id = randomUUID();
  await reserve(
    db,
    org,
    id,
    "browserMinutes",
    Math.min(60, selected.length * 5),
  );
  const busy = await one(
    db,
    "select count(*) n from runs where state in ('queued','preparing','running','cancelling')",
  );
  if (Number(busy.n) >= 20)
    throw new AppError(429, "QUEUE_FULL", "The local run queue is full");
  const manifest = {
    schemaVersion: 1,
    environment: {
      id: env.id,
      baseUrl: env.base_url,
      origins: [new URL(env.base_url).origin, ...env.allowed_origins],
      buildPath: env.build_path,
    },
    cases: selected.map((c) => ({
      id: c.id,
      hash: c.hash,
      definition: c.definition,
    })),
    expectedBuild: request.expectedBuild || null,
    retry: request.retry !== false,
    trace: request.trace === true,
  };
  const r = await one(
    db,
    "insert into runs(id,org_id,project_id,environment_id,suite_id,actor_id,trigger,manifest,manifest_hash,idempotency_key,request_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *",
    [
      id,
      org,
      request.projectId,
      env.id,
      suite?.id || null,
      actor,
      trigger,
      JSON.stringify(manifest),
      hash(manifest),
      key,
      requestHash,
    ],
  );
  for (const [i, c] of selected.entries())
    await db.query(
      "insert into run_cases(id,org_id,run_id,version_id,ordinal,title) values($1,$2,$3,$4,$5,$6)",
      [randomUUID(), org, id, c.id, i, c.title],
    );
  await outbox(db, org, "regression", id);
  await event(db, org, id, "run.created", { cases: selected.length });
  await audit(db, org, actor, "run.created", id);
  return r;
}
