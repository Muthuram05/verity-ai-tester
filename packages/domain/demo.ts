import { randomUUID } from "node:crypto";
import type { DB } from "../db/index.js";
import { saveCase, entitlement, AppError } from "./service.js";
import { encrypt, hash } from "./security.js";
import type { Step, Target, TestCase } from "../contracts/index.js";
const t = (
  kind: Target["kind"],
  value: string,
  role: Target["role"] = null,
): Target => ({ kind, value, role });
const step = (
  op: Step["op"],
  target: Target | null = null,
  value: string | null = null,
  path: string | null = null,
): Step => ({ op, target, value, path });
const go = (p: string) => step("navigate", null, null, p);
const click = (v: string) => step("click", t("role", v, "button"));
const fill = (label: string, v: string) => step("fill", t("label", label), v);
const text = (v: string, target = "message") =>
  step("assertText", t("testId", target), v);
const reload = () => step("reload");
const heading = (v: string) => step("assertVisible", t("role", v, "heading"));
export function demoCases(reqs: Record<string, string>): TestCase[] {
  const c = (
    title: string,
    module: string,
    steps: Step[],
    roleRef: string | null = "alex",
  ): TestCase => ({
    title,
    module,
    priority: ["Profile", "Permissions"].includes(module)
      ? "critical"
      : "normal",
    roleRef,
    requirementIds: [reqs[module]],
    preconditions:
      "Fresh isolated Gather fixture with Alex and Sam accounts and two seeded posts.",
    steps,
    cleanup: [],
    retrySafe: true,
  });
  const alert = (s: string) => step("assertText", t("role", "", "alert"), s);
  const status = (s: string) => step("assertText", t("role", "", "status"), s);
  return [
    c(
      "Valid account can sign in",
      "Authentication",
      [
        go("/login"),
        fill("Email", "alex@example.test"),
        fill("Password", "demo-password"),
        click("Sign in"),
        heading("Your community"),
      ],
      null,
    ),
    c(
      "Wrong password is rejected",
      "Authentication",
      [
        go("/login"),
        fill("Email", "alex@example.test"),
        fill("Password", "wrong-password"),
        click("Sign in"),
        alert("Email or password is incorrect"),
      ],
      null,
    ),
    c(
      "Signed out visitors return to sign in",
      "Authentication",
      [go("/profile"), heading("Welcome back")],
      null,
    ),
    c("Signing out closes the session", "Authentication", [
      go("/feed"),
      click("Sign out"),
      go("/profile"),
      heading("Welcome back"),
    ]),
    c("Profile loads the account name", "Profile", [
      go("/profile"),
      step("assertValue", t("label", "Display name"), "Alex Morgan"),
    ]),
    c("Profile name survives reload", "Profile", [
      go("/profile"),
      fill("Display name", "Alex Updated"),
      click("Save profile"),
      status("Profile saved"),
      reload(),
      step("assertValue", t("label", "Display name"), "Alex Updated"),
    ]),
    c("Profile bio survives reload", "Profile", [
      go("/profile"),
      fill("Bio", "I build reliable applications."),
      click("Save profile"),
      status("Profile saved"),
      reload(),
      step("assertValue", t("label", "Bio"), "I build reliable applications."),
    ]),
    c("Blank display name is rejected", "Profile", [
      go("/profile"),
      fill("Display name", ""),
      click("Save profile"),
      status("Display name is required"),
    ]),
    c("Feed shows seeded posts", "Posts", [
      go("/feed"),
      step("assertText", t("testId", "post-body-1"), "A small update"),
    ]),
    c("New post appears in the feed", "Posts", [
      go("/feed"),
      fill("Post text", "A regression test post"),
      click("Publish post"),
      step("assertText", t("testId", "posts"), "A regression test post"),
    ]),
    c("Published post survives reload", "Posts", [
      go("/feed"),
      fill("Post text", "This post persists"),
      click("Publish post"),
      step("assertText", t("testId", "posts"), "This post persists"),
      reload(),
      step("assertText", t("testId", "posts"), "This post persists"),
    ]),
    c("Empty posts cannot be published", "Posts", [
      go("/feed"),
      fill("Post text", ""),
      click("Publish post"),
      alert("Write something before publishing"),
    ]),
    c("Own post can be edited", "Posts", [
      go("/feed"),
      click("Edit post 1"),
      fill("Edit post text", "Updated post text"),
      click("Save post"),
      step("assertText", t("testId", "post-body-1"), "Updated post text"),
      reload(),
      step("assertText", t("testId", "post-body-1"), "Updated post text"),
    ]),
    c("Own post can be deleted", "Posts", [
      go("/feed"),
      click("Delete post 1"),
      step("assertAbsent", t("testId", "post-1")),
    ]),
    c("Search finds matching posts", "Search", [
      go("/search"),
      fill("Search posts", "confidence"),
      step("assertText", t("testId", "results"), "Testing gives us confidence"),
    ]),
    c("Search reports an empty result", "Search", [
      go("/search"),
      fill("Search posts", "zz-no-result"),
      status("No posts found"),
    ]),
    c("Search is case insensitive", "Search", [
      go("/search"),
      fill("Search posts", "CONFIDENCE"),
      step("assertText", t("testId", "results"), "Testing gives us confidence"),
    ]),
    c("Comments are shown after submission", "Discussion", [
      go("/comments"),
      fill("Comment", "A useful discussion"),
      click("Add comment"),
      step("assertText", t("testId", "comments"), "A useful discussion"),
    ]),
    c("Empty comments are rejected", "Discussion", [
      go("/comments"),
      fill("Comment", ""),
      click("Add comment"),
      alert("Comment cannot be empty"),
    ]),
    c("Comment survives reload", "Discussion", [
      go("/comments"),
      fill("Comment", "Persisted comment"),
      click("Add comment"),
      step("assertText", t("testId", "comments"), "Persisted comment"),
      reload(),
      step("assertText", t("testId", "comments"), "Persisted comment"),
    ]),
    c("Other authors have no edit button", "Permissions", [
      go("/feed"),
      step("assertAbsent", t("role", "Edit post 2", "button")),
    ]),
    c("Other authors have no delete button", "Permissions", [
      go("/feed"),
      step("assertAbsent", t("role", "Delete post 2", "button")),
    ]),
  ];
}
export async function seedDemo(db: DB, org: string) {
  const sub = await entitlement(db, org);
  const count = (await db.query("select count(*) n from projects")).rows[0];
  if (Number(count.n) >= sub.limits.projects)
    throw new AppError(429, "PROJECT_LIMIT", "Project limit reached");
  const project = randomUUID(),
    env = randomUUID();
  await db.query(
    "insert into projects(id,org_id,name,description) values($1,$2,$3,$4)",
    [
      project,
      org,
      "Gather community",
      "Owned presentation application with isolated synthetic fixtures and controlled defects.",
    ],
  );
  await db.query(
    "insert into environments(id,org_id,project_id,name,base_url,build_path) values($1,$2,$3,$4,$5,$6)",
    [env, org, project, "Local demo", process.env.DEMO_ORIGIN, "/__build"],
  );
  const bodies: Record<string, string> = {
    Authentication:
      "Valid accounts can sign in with their email and password. Invalid passwords show Email or password is incorrect. Protected pages redirect signed-out visitors to /login. Sign out ends the session.",
    Profile:
      "Alex starts with Display name Alex Morgan. Profile name and bio must persist after Save profile and page reload. Blank names show Display name is required. Successful save shows Profile saved.",
    Posts:
      "The feed shows seeded posts. Publishing nonempty Post text adds a post that survives reload. Empty posts show Write something before publishing. Authors can edit and delete their own posts. Saved edits persist after reload.",
    Search:
      "Search posts filters post text case insensitively. No matches show No posts found. Searching confidence finds Testing gives us confidence to ship.",
    Discussion:
      "Nonempty comments appear immediately and persist after reload. Empty comments show Comment cannot be empty.",
    Permissions:
      "Only the author has Edit and Delete buttons on a post. Alex owns post 1 and Sam owns post 2. UI assertions do not prove API authorization.",
  };
  const reqs: Record<string, string> = {};
  for (const [title, body] of Object.entries(bodies)) {
    const id = randomUUID();
    reqs[title] = id;
    await db.query(
      "insert into requirements(id,org_id,project_id,requirement_key,revision,title,body,hash) values($1,$2,$3,$1,1,$4,$5,$6)",
      [id, org, project, title, body, hash(body)],
    );
  }
  for (const name of ["alex", "sam"])
    await db.query(
      "insert into secret_refs(id,org_id,environment_id,name,payload) values($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        org,
        env,
        name,
        JSON.stringify(
          encrypt({
            email: `${name}@example.test`,
            password: "demo-password",
            loginPath: "/login",
            emailLabel: "Email",
            passwordLabel: "Password",
            submitName: "Sign in",
          }),
        ),
      ],
    );
  const cases = [];
  for (const c of demoCases(reqs))
    cases.push(await saveCase(db, org, project, c, "demo-authored"));
  return { projectId: project, environmentId: env, cases: cases.length };
}
