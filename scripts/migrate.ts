import "dotenv/config";
import pg from "pg";
import { readFile } from "node:fs/promises";
const admin = new pg.Client({
  connectionString: process.env.DATABASE_ADMIN_URL,
});
await admin.connect();
try {
  await admin.query("BEGIN");
  for (const [role, key] of [
    ["aitester_app", "APP_DB_PASSWORD"],
    ["aitester_queue", "QUEUE_DB_PASSWORD"],
  ]) {
    if (
      !(await admin.query("select 1 from pg_roles where rolname=$1", [role]))
        .rowCount
    )
      await admin.query(
        `CREATE ROLE ${pg.escapeIdentifier(role)} LOGIN PASSWORD ${pg.escapeLiteral(process.env[key]!)} NOSUPERUSER NOBYPASSRLS`,
      );
  }
  await admin.query(
    "GRANT CONNECT,CREATE ON DATABASE aitester TO aitester_queue",
  );
  await admin.query(
    "CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION aitester_queue",
  );
  const exists = await admin.query(
    "select to_regclass('public.schema_migrations') as name",
  );
  if (!exists.rows[0].name)
    await admin.query(await readFile("packages/db/schema.sql", "utf8"));
  if (
    !(await admin.query("select 1 from schema_migrations where version=2"))
      .rowCount
  )
    await admin.query(await readFile("packages/db/migration-002.sql", "utf8"));
  const tenantTables = [
    "projects",
    "environments",
    "secret_refs",
    "requirements",
    "discoveries",
    "cases",
    "case_versions",
    "suites",
    "runs",
    "run_cases",
    "attempts",
    "artifacts",
    "run_events",
    "ai_requests",
    "subscriptions",
    "usage_ledger",
    "reservations",
    "schedules",
    "schedule_fires",
    "change_sets",
    "outbox",
    "audit_events",
  ];
  for (const t of tenantTables) {
    await admin.query(
      `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${t} FORCE ROW LEVEL SECURITY; DROP POLICY IF EXISTS tenant ON ${t}; CREATE POLICY tenant ON ${t} USING (org_id = nullif(current_setting('app.org_id',true),'')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id',true),'')::uuid)`,
    );
  }
  await admin.query(
    "GRANT USAGE ON SCHEMA public TO aitester_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO aitester_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO aitester_app",
  );
  await admin.query(
    "REVOKE UPDATE,DELETE ON requirements,usage_ledger,audit_events FROM aitester_app",
  );
  await admin.query("COMMIT");
  console.log(
    "Database schema v2 ready. Runtime role has enforced tenant policies; queue uses a separate role.",
  );
} catch (e) {
  await admin.query("ROLLBACK");
  throw e;
} finally {
  await admin.end();
}
