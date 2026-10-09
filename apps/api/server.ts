import "dotenv/config";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
  hash as passwordHash,
  verify as passwordVerify,
} from "@node-rs/argon2";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import { pool, tx, one, rows, type DB } from "../../packages/db/index.js";
import {
  caseSchema,
  stepSchema,
  plans,
} from "../../packages/contracts/index.js";
import {
  hash,
  encrypt,
  targetURL,
  redact,
  csv,
  escapeHTML,
} from "../../packages/domain/security.js";
import {
  AppError,
  need,
  audit,
  approve,
  saveCase,
  createRun,
  reserve,
  outbox,
  entitlement,
  event,
} from "../../packages/domain/service.js";
import { seedDemo } from "../../packages/domain/demo.js";
import { providerStatus, verifyProvider } from "../../packages/ai/codex.js";
import { repository, changes } from "../../packages/domain/git.js";
const app = Fastify({
  logger: {
    level: "warn",
    redact: [
      "req.headers.cookie",
      "req.headers.authorization",
      "req.body.password",
      "req.body.setupToken",
    ],
  },
  bodyLimit: 256 * 1024,
  requestTimeout: 310000,
});
await app.register(cookie);
await app.register(rateLimit, { max: 600, timeWindow: 60000 });
await app.register(swagger, {
  openapi: { info: { title: "Verity local testing API", version: "0.1.0" } },
});
const publicRoutes = new Set([
  "/api/v1/setup/status",
  "/api/v1/setup",
  "/api/v1/sessions",
  "/api/v1/health",
]);
const port = Number(process.env.API_PORT || 4000);
const webOrigin = process.env.WEB_ORIGIN!;
const hosts = new Set([
  new URL(webOrigin).host,
  `127.0.0.1:${port}`,
  `localhost:${port}`,
  "localhost:3000",
]);
type Actor = {
  id: string;
  org_id: string;
  role: string;
  name: string;
  email: string;
  csrf: string;
};
const actor = (r: FastifyRequest) => (r as any).actor as Actor;
app.addHook("onRequest", async (req, reply) => {
  if (!hosts.has(req.headers.host || ""))
    return reply.code(403).send({
      code: "HOST_REJECTED",
      message: "Use the configured localhost address",
    });
  if (
    req.headers.origin &&
    ![webOrigin, `http://127.0.0.1:${port}`, "http://localhost:3000"].includes(
      req.headers.origin,
    )
  )
    return reply
      .code(403)
      .send({ code: "ORIGIN_REJECTED", message: "Origin is not allowed" });
  if (!req.url.startsWith("/api/")) return;
  if (publicRoutes.has(req.url.split("?")[0])) return;
  const token = req.cookies.verity;
  if (!token)
    throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in to continue");
  const u = await tx(undefined, (db) =>
    one(
      db,
      "select u.id,u.name,u.email,s.org_id,s.csrf,m.role from sessions s join users u on u.id=s.user_id join memberships m on m.user_id=u.id and m.org_id=s.org_id and m.active where s.token_hash=$1 and s.expires_at>now()",
      [hash(token)],
    ),
  );
  if (!u)
    throw new AppError(
      401,
      "SESSION_EXPIRED",
      "Your session has expired. Sign in again.",
    );
  (req as any).actor = u;
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers["x-csrf-token"] !== u.csrf
  )
    throw new AppError(
      403,
      "CSRF_REJECTED",
      "Refresh the page before trying again",
    );
});
app.addHook("onSend", async (_req, reply, payload) => {
  reply
    .header("X-Content-Type-Options", "nosniff")
    .header("Referrer-Policy", "same-origin")
    .header("Cache-Control", "no-store");
  return payload;
});
app.setErrorHandler((error, req, reply) => {
  const e = error as any;
  const status =
    e instanceof AppError
      ? e.status
      : e instanceof z.ZodError || e.validation || e.name === "InputError"
        ? 422
        : e.code === "23505"
          ? 409
          : e.code === "22P02"
            ? 422
            : 500;
  reply.code(status).send({
    code: e.code || "REQUEST_FAILED",
    message:
      status === 500
        ? "The operation could not complete. Check local service health."
        : e instanceof z.ZodError
          ? e.issues
              .map((i: any) => `${i.path.join(".")}: ${i.message}`)
              .join(";")
          : e.message,
    retryable: status >= 500,
    correlationId: req.id,
  });
  if (status === 500) console.error("API error", e.message);
});
const id = z.string().uuid();
const short = z.string().trim().min(1).max(180);
const empty = z.object({}).strict();
function route(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  role: "read" | "write" | "owner",
  schema: z.ZodType | undefined,
  handler: (
    r: FastifyRequest,
    reply: FastifyReply,
    db: DB,
    b: any,
    u: Actor,
  ) => Promise<any>,
) {
  app.route({
    method,
    url: "/api/v1" + url,
    schema: schema
      ? { body: z.toJSONSchema(schema, { target: "draft-7" }) }
      : undefined,
    validatorCompiler: schema
      ? () => (data) => {
          const parsed = schema.safeParse(data);
          return parsed.success
            ? { value: parsed.data }
            : { error: parsed.error };
        }
      : undefined,
    handler: async (req, reply) => {
      const u = actor(req);
      if (
        (role === "owner" && u.role !== "owner") ||
        (role === "write" && u.role === "viewer")
      )
        throw new AppError(
          403,
          "ROLE_DENIED",
          "Your role cannot perform this action",
        );
      const b = schema ? schema.parse(req.body) : undefined;
      return tx(u.org_id, async (db) => {
        const result = await handler(req, reply, db, b, u);
        if (method !== "GET")
          await audit(db, u.org_id, u.id, "api.mutation", null, {
            method,
            route: url,
          });
        return result;
      });
    },
  });
}
const param = (r: FastifyRequest, key = "id") =>
  id.parse((r.params as any)[key]);
async function session(db: DB, reply: FastifyReply, user: string, org: string) {
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(24).toString("hex");
  await db.query(
    "insert into sessions(token_hash,user_id,org_id,csrf,expires_at) values($1,$2,$3,$4,now()+interval '24 hours')",
    [hash(token), user, org, csrf],
  );
  reply.setCookie("verity", token, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: webOrigin.startsWith("https:"),
    maxAge: 86400,
  });
  return { csrf };
}
app.get("/api/v1/health", async () => ({
  status: "ok",
  service: "verity",
  mode: "localhost",
}));
app.get("/api/v1/setup/status", async () => ({
  required: !(await pool.query("select 1 from users limit 1")).rowCount,
}));
app.post(
  "/api/v1/setup",
  { config: { rateLimit: { max: 10, timeWindow: 60000 } } },
  async (req, reply) => {
    const b = z
      .object({
        name: short,
        email: z.email(),
        password: z.string().min(12).max(200),
        setupToken: z.string(),
      })
      .parse(req.body);
    const expected = process.env.SETUP_TOKEN || "";
    if (
      b.setupToken.length !== expected.length ||
      !timingSafeEqual(Buffer.from(b.setupToken), Buffer.from(expected))
    )
      throw new AppError(
        403,
        "SETUP_TOKEN",
        "Use the setup token generated in your local .env file",
      );
    const ph = await passwordHash(b.password);
    return tx(undefined, async (db) => {
      await db.query("select pg_advisory_xact_lock(719031)");
      if (await one(db, "select 1 from users limit 1"))
        throw new AppError(
          409,
          "ALREADY_SETUP",
          "The first owner already exists",
        );
      const org = randomUUID(),
        user = randomUUID();
      await db.query("insert into organizations(id,name) values($1,$2)", [
        org,
        "My testing workspace",
      ]);
      await db.query("select set_config('app.org_id',$1,true)", [org]);
      await db.query(
        "insert into users(id,name,email,password_hash) values($1,$2,$3,$4)",
        [user, b.name, b.email.toLowerCase(), ph],
      );
      await db.query(
        "insert into memberships(org_id,user_id,role) values($1,$2,'owner')",
        [org, user],
      );
      await db.query("insert into subscriptions(org_id) values($1)", [org]);
      return session(db, reply, user, org);
    });
  },
);
app.post(
  "/api/v1/sessions",
  { config: { rateLimit: { max: 10, timeWindow: 60000 } } },
  async (req, reply) => {
    const b = z
      .object({ email: z.email(), password: z.string().max(200) })
      .parse(req.body);
    const user = await tx(undefined, (db) =>
      one(
        db,
        "select u.*,m.org_id from users u join memberships m on m.user_id=u.id and m.active where u.email=$1 order by u.created_at limit 1",
        [b.email.toLowerCase()],
      ),
    );
    if (!user || !(await passwordVerify(user.password_hash, b.password)))
      throw new AppError(
        401,
        "INVALID_LOGIN",
        "Email or password is incorrect",
      );
    return tx(undefined, (db) => session(db, reply, user.id, user.org_id));
  },
);
route("DELETE", "/sessions", "read", undefined, async (r, reply, db) => {
  await db.query("delete from sessions where token_hash=$1", [
    hash(r.cookies.verity!),
  ]);
  reply.clearCookie("verity", { path: "/" });
  return { ok: true };
});
route("GET", "/me", "read", undefined, async (_r, _p, _db, _b, u) => u);
route("GET", "/health/details", "read", undefined, async () => {
  let worker: any = null,
    ai: any = null;
  try {
    worker = JSON.parse(await readFile(".local/worker.json", "utf8"));
    worker.healthy =
      Date.now() - Date.parse(worker.at) < 15000 &&
      worker.browserReady === true;
  } catch {}
  try {
    ai = JSON.parse(await readFile(".local/ai-readiness.json", "utf8"));
  } catch {}
  return {
    database: "connected",
    worker,
    provider: await providerStatus(),
    inferenceVerified: ai?.verifiedAt || null,
    billingMode: "demo",
    integrations: { github: "not_configured", payments: "demo", git: "local" },
  };
});
route("POST", "/provider/check", "owner", empty, async () => {
  const r = await verifyProvider();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(".local/ai-readiness.json", JSON.stringify(r), {
    mode: 0o600,
  });
  return { verifiedAt: r.verifiedAt, model: r.model };
});
route("GET", "/overview", "read", undefined, async (_r, _p, db) => {
  const stats = await one(
    db,
    `select (select count(*) from projects) projects,(select count(*) from cases where not archived) cases,(select count(*) from case_versions v join cases c on c.id=v.case_id and v.version=c.current_version where v.status='approved' and not c.archived) approved,(select count(*) from runs) runs,(select count(*) from runs where state in ('running','preparing','queued')) active`,
  );
  const recent = await rows(
    db,
    "select r.id,r.state,r.verdict,r.created_at,r.finished_at,p.name project_name,jsonb_array_length(r.manifest->'cases') case_count from runs r join projects p on p.id=r.project_id order by r.created_at desc limit 12",
  );
  return { stats, recent };
});
route("GET", "/projects", "read", undefined, async (_r, _p, db) =>
  rows(
    db,
    "select p.*,(select count(*) from cases c where c.project_id=p.id and not c.archived) case_count from projects p order by created_at desc limit 100",
  ),
);
route(
  "POST",
  "/projects",
  "owner",
  z
    .object({
      name: short,
      description: z.string().max(2000).default(""),
      baseUrl: z.url(),
      allowedOrigins: z.array(z.url()).max(10).default([]),
    })
    .strict(),
  async (_r, reply, db, b, u) => {
    const sub = await entitlement(db, u.org_id);
    if (
      Number((await one(db, "select count(*) n from projects")).n) >=
      sub.limits.projects
    )
      throw new AppError(
        429,
        "PROJECT_LIMIT",
        "Your plan has reached its project limit",
      );
    const url = targetURL(b.baseUrl);
    const origins = b.allowedOrigins.map((v: string) => targetURL(v).origin);
    const pid = randomUUID(),
      eid = randomUUID();
    await db.query(
      "insert into projects(id,org_id,name,description) values($1,$2,$3,$4)",
      [pid, u.org_id, b.name, b.description],
    );
    await db.query(
      "insert into environments(id,org_id,project_id,name,base_url,allowed_origins) values($1,$2,$3,$4,$5,$6)",
      [eid, u.org_id, pid, "Development", url.href, JSON.stringify(origins)],
    );
    reply.code(201);
    return { id: pid, environmentId: eid };
  },
);
route(
  "POST",
  "/projects/:id/environments",
  "owner",
  z
    .object({
      name: short,
      baseUrl: z.url(),
      allowedOrigins: z.array(z.url()).max(10).default([]),
    })
    .strict(),
  async (r, reply, db, b, u) => {
    const pid = param(r);
    need(
      await one(db, "select id from projects where id=$1 for update", [pid]),
    );
    await entitlement(db, u.org_id);
    const count = await one(
      db,
      "select count(*) n from environments where project_id=$1",
      [pid],
    );
    if (Number(count.n) >= 10)
      throw new AppError(
        429,
        "ENVIRONMENT_LIMIT",
        "A local project supports up to ten environments",
      );
    const url = targetURL(b.baseUrl);
    const origins = b.allowedOrigins.map(
      (value: string) => targetURL(value).origin,
    );
    const eid = randomUUID();
    await db.query(
      "insert into environments(id,org_id,project_id,name,base_url,allowed_origins) values($1,$2,$3,$4,$5,$6)",
      [eid, u.org_id, pid, b.name, url.href, JSON.stringify(origins)],
    );
    reply.code(201);
    return { id: eid };
  },
);
route("POST", "/demo", "owner", empty, async (_r, reply, db, _b, u) => {
  reply.code(201);
  return seedDemo(db, u.org_id);
});
route(
  "POST",
  "/demo/mode",
  "owner",
  z.object({ mode: z.enum(["fixed", "buggy"]) }).strict(),
  async (_r, _p, db, b, u) => {
    const busy = await one(
      db,
      "select 1 from runs where state in ('running','preparing','cancelling') limit 1",
    );
    if (busy)
      throw new AppError(
        409,
        "RUN_ACTIVE",
        "Wait for active runs before changing the demo build",
      );
    const res = await fetch(process.env.DEMO_ORIGIN + "/__control", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-key": process.env.DEMO_KEY!,
      },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok)
      throw new AppError(
        503,
        "DEMO_UNAVAILABLE",
        "Demo control is unavailable",
      );
    await audit(db, u.org_id, u.id, "demo.build_changed", null, b);
    return res.json();
  },
);
route("GET", "/demo/build", "read", undefined, async () => {
  const r = await fetch(process.env.DEMO_ORIGIN + "/__build", {
    signal: AbortSignal.timeout(5000),
  });
  return r.json();
});
route("GET", "/projects/:id", "read", undefined, async (r, _p, db) => {
  const pid = param(r);
  const project = need(
    await one(db, "select * from projects where id=$1", [pid]),
  );
  const [
    environments,
    requirements,
    cases,
    discoveries,
    generations,
    suites,
    schedules,
    changes,
  ] = [
    await rows(db, "select * from environments where project_id=$1", [pid]),
    await rows(
      db,
      "select * from requirements where project_id=$1 order by created_at desc",
      [pid],
    ),
    await rows(
      db,
      "select v.*,c.archived from case_versions v join cases c on c.id=v.case_id and v.version=c.current_version where c.project_id=$1 order by v.module,v.title,v.id",
      [pid],
    ),
    await rows(
      db,
      "select d.* from discoveries d join environments e on e.id=d.environment_id where e.project_id=$1 order by d.created_at desc limit 20",
      [pid],
    ),
    await rows(
      db,
      "select id,state,model,usage,error,result_ids,questions,created_at from ai_requests where project_id=$1 order by created_at desc limit 20",
      [pid],
    ),
    await rows(
      db,
      "select * from suites where project_id=$1 order by created_at desc",
      [pid],
    ),
    await rows(db, "select * from schedules where project_id=$1", [pid]),
    await rows(
      db,
      "select * from change_sets where project_id=$1 order by created_at desc limit 10",
      [pid],
    ),
  ];
  const secrets = await rows(
    db,
    "select s.id,s.environment_id,s.name from secret_refs s join environments e on e.id=s.environment_id where e.project_id=$1",
    [pid],
  );
  return {
    project,
    environments,
    requirements,
    cases,
    discoveries,
    generations,
    suites,
    schedules,
    changes,
    secrets,
  };
});
route(
  "POST",
  "/environments/:id/secrets",
  "owner",
  z
    .object({
      name: z.string().trim().min(1).max(80),
      email: z.string().max(200),
      password: z.string().min(1).max(200),
      loginPath: z.string().startsWith("/").max(200),
      emailLabel: short,
      passwordLabel: short,
      submitName: short,
    })
    .strict(),
  async (r, _p, db, b, u) => {
    need(await one(db, "select 1 from environments where id=$1", [param(r)]));
    if (b.loginPath.startsWith("//") || b.loginPath.includes("\\"))
      throw new AppError(
        422,
        "INVALID_LOGIN_PATH",
        "Use a relative application login path",
      );
    const { name, ...payload } = b;
    await db.query(
      "insert into secret_refs(id,org_id,environment_id,name,payload) values($1,$2,$3,$4,$5) on conflict(environment_id,name) do update set payload=excluded.payload",
      [
        randomUUID(),
        u.org_id,
        param(r),
        name,
        JSON.stringify(encrypt(payload)),
      ],
    );
    return { saved: true };
  },
);
route(
  "POST",
  "/projects/:id/requirements",
  "write",
  z
    .object({
      title: short,
      body: z.string().min(5).max(15000),
      previousId: id.optional(),
    })
    .strict(),
  async (r, reply, db, b, u) => {
    const pid = param(r);
    need(await one(db, "select 1 from projects where id=$1", [pid]));
    const old = b.previousId
      ? need(
          await one(
            db,
            "select * from requirements where id=$1 and project_id=$2",
            [b.previousId, pid],
          ),
        )
      : null;
    const rid = randomUUID();
    if (old) {
      await db.query(
        "update case_versions set status='needs_review' where source_ids ? $1 and status='approved'",
        [old.id],
      );
    }
    await db.query(
      "insert into requirements(id,org_id,project_id,requirement_key,revision,title,body,hash) values($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        rid,
        u.org_id,
        pid,
        old?.requirement_key || rid,
        (old?.revision || 0) + 1,
        b.title,
        b.body,
        hash(b.body),
      ],
    );
    reply.code(201);
    return { id: rid };
  },
);
route(
  "POST",
  "/environments/:id/discoveries",
  "write",
  z
    .object({
      roleRef: z.string().nullable().default(null),
      maxPages: z.number().int().min(1).max(20).default(8),
      paths: z.array(z.string().startsWith("/")).max(20).default([]),
      guided: z.array(stepSchema).max(20).default([]),
    })
    .strict(),
  async (r, reply, db, b, u) => {
    need(await one(db, "select 1 from environments where id=$1", [param(r)]));
    await entitlement(db, u.org_id);
    const did = randomUUID();
    await reserve(db, u.org_id, did, "browserMinutes", 10);
    await db.query(
      "insert into discoveries(id,org_id,environment_id,limits) values($1,$2,$3,$4)",
      [did, u.org_id, param(r), JSON.stringify(b)],
    );
    await outbox(db, u.org_id, "discovery", did);
    reply.code(202);
    return { id: did };
  },
);
route(
  "POST",
  "/projects/:id/generations",
  "write",
  z
    .object({
      count: z.number().int().min(1).max(10).default(5),
      focus: z.string().max(2000).default(""),
    })
    .strict(),
  async (r, reply, db, b, u) => {
    const pid = param(r);
    need(await one(db, "select 1 from projects where id=$1", [pid]));
    const requirements = await rows(
      db,
      "select distinct on(requirement_key) id,title,body,revision from requirements where project_id=$1 order by requirement_key,revision desc",
      [pid],
    );
    const discovery = await one(
      db,
      "select d.* from discoveries d join environments e on e.id=d.environment_id where e.project_id=$1 and d.state='completed' order by d.created_at desc limit 1",
      [pid],
    );
    if (!requirements.length || !discovery)
      throw new AppError(
        422,
        "SOURCES_REQUIRED",
        "Add requirements and complete application discovery first",
      );
    const secrets = await rows(
      db,
      "select s.name from secret_refs s join environments e on e.id=s.environment_id where e.project_id=$1",
      [pid],
    );
    const context = {
      requirements: requirements.map((r) => ({ ...r, body: redact(r.body) })),
      pages: discovery.pages,
      count: b.count,
      focus: redact(b.focus),
      roles: secrets.map((s) => s.name),
    };
    if (JSON.stringify(context).length > 80000)
      throw new AppError(
        422,
        "CONTEXT_LIMIT",
        "Narrow the discovery or requirements for this generation",
      );
    const aid = randomUUID();
    await reserve(db, u.org_id, aid, "aiRequests", 1);
    await db.query(
      "insert into ai_requests(id,org_id,project_id,context,context_hash) values($1,$2,$3,$4,$5)",
      [aid, u.org_id, pid, JSON.stringify(context), hash(context)],
    );
    await outbox(db, u.org_id, "generation", aid);
    reply.code(202);
    return { id: aid };
  },
);
route(
  "POST",
  "/projects/:id/cases",
  "write",
  caseSchema,
  async (r, reply, db, b, u) => {
    reply.code(201);
    return saveCase(db, u.org_id, param(r), b, "authored");
  },
);
route(
  "PATCH",
  "/cases/:id",
  "write",
  z
    .object({
      definition: caseSchema,
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
  async (r, _p, db, b, u) => {
    const c = need(
      await one(db, "select * from cases where id=$1", [param(r)]),
    );
    return saveCase(
      db,
      u.org_id,
      c.project_id,
      b.definition,
      "edited",
      c.id,
      b.expectedVersion,
    );
  },
);
route(
  "POST",
  "/case-versions/:id/approvals",
  "write",
  z.object({ hash: z.string() }).strict(),
  async (r, _p, db, b, u) => {
    await approve(db, u.org_id, u.id, param(r), b.hash);
    return { approved: true };
  },
);
route(
  "POST",
  "/case-versions/:id/review",
  "write",
  z.object({ status: z.enum(["draft", "ready", "rejected"]) }).strict(),
  async (r, _p, db, b, u) => {
    need(await one(db, "select 1 from case_versions where id=$1", [param(r)]));
    await db.query(
      "update case_versions set status=$1,approved_at=null,approved_by=null where id=$2",
      [b.status, param(r)],
    );
    await audit(db, u.org_id, u.id, "case.review_changed", param(r), b);
    return { ok: true };
  },
);
route(
  "POST",
  "/cases/:id/archive",
  "write",
  z.object({ archived: z.boolean() }).strict(),
  async (r, _p, db, b) => {
    const c = await one(
      db,
      "update cases set archived=$1 where id=$2 returning id",
      [b.archived, param(r)],
    );
    need(c);
    return c;
  },
);
route("GET", "/cases/:id/history", "read", undefined, async (r, _p, db) =>
  rows(
    db,
    "select * from case_versions where case_id=$1 order by version desc",
    [param(r)],
  ),
);
route(
  "POST",
  "/suites",
  "write",
  z
    .object({
      projectId: id,
      name: short,
      versionIds: z.array(id).min(1).max(100),
    })
    .strict(),
  async (_r, reply, db, b, u) => {
    const versions = await rows(
      db,
      "select v.id from case_versions v join cases c on c.id=v.case_id where v.id=any($1::uuid[]) and c.project_id=$2 and not c.archived and v.status='approved' and v.version=c.current_version",
      [b.versionIds, b.projectId],
    );
    if (versions.length !== new Set(b.versionIds).size)
      throw new AppError(
        422,
        "INVALID_SUITE",
        "Suites must contain current approved scenarios",
      );
    const sid = randomUUID();
    await db.query(
      "insert into suites(id,org_id,project_id,name,version_ids) values($1,$2,$3,$4,$5)",
      [sid, u.org_id, b.projectId, b.name, JSON.stringify(b.versionIds)],
    );
    reply.code(201);
    return { id: sid };
  },
);
const runSchema = z
  .object({
    projectId: id,
    environmentId: id,
    suiteId: id.optional(),
    versionIds: z.array(id).min(1).max(100).optional(),
    expectedBuild: z.string().max(200).optional(),
    retry: z.boolean().default(true),
    trace: z.boolean().default(false),
  })
  .strict();
route("POST", "/runs", "write", runSchema, async (r, reply, db, b, u) => {
  const key = z.string().min(8).max(160).parse(r.headers["idempotency-key"]);
  const result = await createRun(db, u.org_id, u.id, b, key);
  reply.code(202);
  return { runId: result.id, state: result.state };
});
route("GET", "/runs", "read", undefined, async (r, _p, db) => {
  const q = r.query as any;
  return rows(
    db,
    `select r.id,r.project_id,r.state,r.verdict,r.created_at,r.finished_at,r.trigger,r.error,p.name project_name,jsonb_array_length(r.manifest->'cases') case_count from runs r join projects p on p.id=r.project_id ${q.projectId ? "where r.project_id=$1" : ""} order by r.created_at desc limit 100`,
    q.projectId ? [id.parse(q.projectId)] : [],
  );
});
route("GET", "/runs/:id", "read", undefined, async (r, _p, db) => {
  const rid = param(r);
  const run = need(await one(db, "select * from runs where id=$1", [rid]));
  const cases = await rows(
    db,
    "select * from run_cases where run_id=$1 order by ordinal",
    [rid],
  );
  const attempts = await rows(
    db,
    "select a.* from attempts a join run_cases c on c.id=a.run_case_id where c.run_id=$1 order by a.created_at",
    [rid],
  );
  const artifacts = await rows(
    db,
    "select a.id,a.attempt_id,a.kind,a.bytes,a.deleted_at from artifacts a join attempts t on t.id=a.attempt_id join run_cases c on c.id=t.run_case_id where c.run_id=$1",
    [rid],
  );
  const events = await rows(
    db,
    "select * from run_events where run_id=$1 order by seq desc limit 100",
    [rid],
  );
  return { run, cases, attempts, artifacts, events };
});
route(
  "POST",
  "/runs/:id/cancellation",
  "write",
  empty,
  async (r, _p, db, _b, u) => {
    const run = need(
      await one(db, "select * from runs where id=$1 for update", [param(r)]),
    );
    if (["queued", "preparing", "running"].includes(run.state)) {
      await db.query("update runs set state='cancelling' where id=$1", [
        run.id,
      ]);
      await event(db, u.org_id, run.id, "run.cancelling", {});
    }
    return { state: "cancelling" };
  },
);
route(
  "GET",
  "/runs/:id/events",
  "read",
  undefined,
  async (r, reply, db, _b, u) => {
    const rid = param(r);
    need(await one(db, "select 1 from runs where id=$1", [rid]));
    let last = Number(r.headers["last-event-id"] || 0);
    if (!Number.isSafeInteger(last) || last < 0) last = 0;
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    let closed = false,
      busy = false;
    const tick = async () => {
      if (busy || closed) return;
      busy = true;
      try {
        const items = await tx(u.org_id, (d) =>
          rows(
            d,
            "select seq,type,payload from run_events where run_id=$1 and seq>$2 order by seq limit 100",
            [rid, last],
          ),
        );
        for (const e of items) {
          reply.raw.write(
            `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e.payload)}\n\n`,
          );
          last = Number(e.seq);
        }
        reply.raw.write(": keepalive\n\n");
      } catch {
        reply.raw.end();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(tick, 1000);
    reply.raw.on("close", () => {
      closed = true;
      clearInterval(timer);
    });
    await tick();
  },
);
route(
  "GET",
  "/artifacts/:id/content",
  "read",
  undefined,
  async (r, reply, db) => {
    const a = need(
      await one(
        db,
        "select * from artifacts where id=$1 and deleted_at is null and expires_at>now()",
        [param(r)],
      ),
    );
    const root = await realpath(".local/artifacts");
    const file = await realpath(path.join(root, a.storage_key));
    if (!file.startsWith(root + path.sep))
      throw new AppError(404, "NOT_FOUND", "Artifact not found");
    reply.type(a.kind === "screenshot" ? "image/png" : "application/zip");
    if (a.kind === "trace")
      reply.header("Content-Disposition", 'attachment; filename="trace.zip"');
    return reply.send(createReadStream(file));
  },
);
route("GET", "/runs/:id/export", "read", undefined, async (r, reply, db) => {
  const run = need(await one(db, "select * from runs where id=$1", [param(r)]));
  const cases = await rows(
    db,
    "select * from run_cases where run_id=$1 order by ordinal",
    [run.id],
  );
  const format = (r.query as any).format || "json";
  if (format === "html") {
    reply
      .header(
        "Content-Disposition",
        `attachment; filename="run-${run.id}.html"`,
      )
      .type("text/html");
    return `<!doctype html><meta charset="utf-8"><title>Verity regression report</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;color:#233f54}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:12px;text-align:left}</style><h1>Regression report</h1><p>Run ${escapeHTML(run.id)}</p><p>Lifecycle: ${escapeHTML(run.state)}. Verdict: ${escapeHTML(run.verdict)}. Build: ${escapeHTML(run.build_status)}.</p><p>Coverage refers to the selected approved suite, not all application behavior.</p><table><tr><th>Scenario</th><th>Outcome</th></tr>${cases.map((c) => `<tr><td>${escapeHTML(c.title)}</td><td>${escapeHTML(c.outcome || c.state)}</td></tr>`).join("")}</table><p>Evidence remains available through the authenticated application.</p>`;
  }
  reply.header(
    "Content-Disposition",
    `attachment; filename="run-${run.id}.json"`,
  );
  return { run, cases };
});
route(
  "GET",
  "/projects/:id/export",
  "read",
  undefined,
  async (r, reply, db) => {
    const cases = await rows(
      db,
      "select v.* from case_versions v join cases c on c.id=v.case_id and c.current_version=v.version where c.project_id=$1",
      [param(r)],
    );
    reply
      .type("text/csv")
      .header("Content-Disposition", 'attachment; filename="scenarios.csv"');
    return [
      "Title,Module,Priority,Version,Status,Origin",
      ...cases.map((c) =>
        [c.title, c.module, c.priority, c.version, c.status, c.origin]
          .map(csv)
          .join(","),
      ),
    ].join("\r\n");
  },
);
route(
  "POST",
  "/schedules",
  "write",
  z
    .object({
      name: short,
      projectId: id,
      environmentId: id,
      suiteId: id,
      cron: z.string().max(100),
      timezone: z.string().max(100).default("Asia/Kolkata"),
    })
    .strict(),
  async (_r, reply, db, b, u) => {
    if (b.cron.trim().split(/\s+/).length !== 5)
      throw new AppError(
        422,
        "INVALID_CRON",
        "Use a five-field minute cron expression",
      );
    let next: Date;
    try {
      next = CronExpressionParser.parse(b.cron, { tz: b.timezone })
        .next()
        .toDate();
    } catch {
      throw new AppError(
        422,
        "INVALID_SCHEDULE",
        "Check the cron expression and IANA timezone",
      );
    }
    need(
      await one(db, "select 1 from suites where id=$1 and project_id=$2", [
        b.suiteId,
        b.projectId,
      ]),
    );
    need(
      await one(
        db,
        "select 1 from environments where id=$1 and project_id=$2",
        [b.environmentId, b.projectId],
      ),
    );
    const sub = await entitlement(db, u.org_id);
    if (
      Number(
        (await one(db, "select count(*) n from schedules where enabled")).n,
      ) >= sub.limits.schedules
    )
      throw new AppError(429, "SCHEDULE_LIMIT", "Schedule allowance reached");
    const sid = randomUUID();
    await db.query(
      "insert into schedules(id,org_id,project_id,environment_id,suite_id,actor_id,name,cron,timezone,next_fire) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        sid,
        u.org_id,
        b.projectId,
        b.environmentId,
        b.suiteId,
        u.id,
        b.name,
        b.cron,
        b.timezone,
        next,
      ],
    );
    reply.code(201);
    return { id: sid, nextFire: next };
  },
);
route(
  "PATCH",
  "/schedules/:id",
  "write",
  z.object({ enabled: z.boolean() }).strict(),
  async (r, _p, db, b) => {
    const s = need(
      await one(db, "select * from schedules where id=$1", [param(r)]),
    );
    if (b.enabled && !s.enabled) {
      const sub = await entitlement(db, s.org_id);
      const count = await one(
        db,
        "select count(*) n from schedules where enabled",
      );
      if (Number(count.n) >= sub.limits.schedules)
        throw new AppError(429, "SCHEDULE_LIMIT", "Schedule allowance reached");
    }
    const next = CronExpressionParser.parse(s.cron, { tz: s.timezone })
      .next()
      .toDate();
    await db.query("update schedules set enabled=$1,next_fire=$2 where id=$3", [
      b.enabled,
      next,
      s.id,
    ]);
    return { ok: true };
  },
);
route("GET", "/schedules", "read", undefined, async (_r, _p, db) => ({
  schedules: await rows(
    db,
    "select s.*,p.name project_name from schedules s join projects p on p.id=s.project_id order by s.created_at desc",
  ),
  fires: await rows(
    db,
    "select * from schedule_fires order by scheduled_at desc limit 50",
  ),
}));
route(
  "POST",
  "/projects/:id/repository",
  "owner",
  z
    .object({
      path: z.string().min(1).max(1000),
      modulePaths: z.record(z.string(), z.string()).default({}),
    })
    .strict(),
  async (r, _p, db, b, u) => {
    const repo = await repository(b.path);
    const p = await one(
      db,
      "update projects set repo_path=$1,module_paths=$2 where id=$3 returning id",
      [repo, JSON.stringify(b.modulePaths), param(r)],
    );
    need(p);
    await audit(db, u.org_id, u.id, "repository.connected", p.id);
    return { path: repo };
  },
);
route(
  "POST",
  "/projects/:id/changes",
  "write",
  z.object({ base: short, head: short }).strict(),
  async (r, _p, db, b, u) => {
    const p = need(
      await one(db, "select * from projects where id=$1", [param(r)]),
    );
    if (!p.repo_path)
      throw new AppError(
        422,
        "REPOSITORY_REQUIRED",
        "Connect a local Git repository first",
      );
    const diff = await changes(p.repo_path, b.base, b.head);
    const cases = await rows(
      db,
      "select v.id,v.module from case_versions v join cases c on c.id=v.case_id and c.current_version=v.version where c.project_id=$1 and v.status='approved' and not c.archived",
      [p.id],
    );
    const mapped = new Set<string>();
    let full = false;
    for (const file of diff.files) {
      const modules = Object.entries(p.module_paths as Record<string, string>)
        .filter(([, prefix]) => file.startsWith(prefix))
        .map(([m]) => m);
      if (
        !modules.length ||
        /auth|config|migration|package|schema|lock/i.test(file)
      )
        full = true;
      modules.forEach((m) => mapped.add(m));
    }
    const selected = full ? cases : cases.filter((c) => mapped.has(c.module));
    const cid = randomUUID(),
      reason = full
        ? "Full suite: shared or unmapped source changes."
        : "Proposal based on explicit module path mappings. Review before running.";
    await db.query(
      "insert into change_sets(id,org_id,project_id,base_sha,head_sha,files,selection,reason) values($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        cid,
        u.org_id,
        p.id,
        diff.baseSHA,
        diff.headSHA,
        JSON.stringify(diff.files),
        JSON.stringify(selected.map((c) => c.id)),
        reason,
      ],
    );
    return { id: cid, ...diff, selection: selected, reason };
  },
);
route("GET", "/usage", "read", undefined, async (_r, _p, db, _b, u) => {
  const subscription = await one(
    db,
    "select * from subscriptions where org_id=$1",
    [u.org_id],
  );
  const usage = await rows(
    db,
    "select metric,sum(amount)::float amount from usage_ledger where metric<>'storageBytes' and created_at>=date_trunc('month',now()) group by metric union all select 'storageBytes',coalesce(sum(bytes),0)::float from artifacts where deleted_at is null",
  );
  const reserved = await rows(
    db,
    "select metric,sum(amount)::float amount from reservations where expires_at>now() group by metric",
  );
  return {
    subscription,
    limits: plans[subscription.plan as keyof typeof plans],
    usage,
    reserved,
    plans,
  };
});
route(
  "POST",
  "/billing/simulations",
  "owner",
  z
    .object({
      plan: z.enum(["starter", "studio"]),
      state: z.enum([
        "trial",
        "active",
        "past_due",
        "cancel_scheduled",
        "cancelled",
      ]),
    })
    .strict(),
  async (_r, _p, db, b, u) => {
    await db.query(
      "update subscriptions set plan=$1,state=$2 where org_id=$3 and billing_mode='demo'",
      [b.plan, b.state, u.org_id],
    );
    await audit(db, u.org_id, u.id, "billing.simulated", null, b);
    return { ...b, billingMode: "demo", charged: 0 };
  },
);
route("GET", "/members", "owner", undefined, async (_r, _p, db, _b, u) =>
  rows(
    db,
    "select u.id,u.name,u.email,m.role,m.active from memberships m join users u on u.id=m.user_id where m.org_id=$1",
    [u.org_id],
  ),
);
route(
  "POST",
  "/members",
  "owner",
  z
    .object({
      name: short,
      email: z.email(),
      password: z.string().min(12).max(200),
      role: z.enum(["maintainer", "viewer"]),
    })
    .strict(),
  async (_r, reply, db, b, u) => {
    const uid = randomUUID();
    await db.query(
      "insert into users(id,name,email,password_hash) values($1,$2,$3,$4)",
      [uid, b.name, b.email.toLowerCase(), await passwordHash(b.password)],
    );
    await db.query(
      "insert into memberships(org_id,user_id,role) values($1,$2,$3)",
      [u.org_id, uid, b.role],
    );
    reply.code(201);
    return { id: uid };
  },
);
route("GET", "/audit", "owner", undefined, async (_r, _p, db) =>
  rows(db, "select * from audit_events order by created_at desc limit 100"),
);
route("GET", "/openapi", "read", undefined, async () => app.swagger());
await app.listen({ host: "127.0.0.1", port });
console.log(`Verity API http://127.0.0.1:${port}`);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
