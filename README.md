# Verity — local AI web testing MVP

Verity connects to a web application's test environment, discovers reachable pages, drafts scenarios from requirements, and executes approved scenarios in isolated Chromium containers. Reports contain browser assertions, screenshots, optional traces, build identity, and the exact scenario versions that ran.

This is the local ME-project implementation. A passing run describes its selected scenarios; it does not prove that an entire application is bug-free.

## Start locally

Requirements: Node.js 22.12 or newer, npm, a running Docker-compatible engine, and PostgreSQL/runner ports available. Allow at least 10 GB of free disk space for the initial browser image. Inference needs internet access and your own authenticated local Codex installation; no API key is bundled, copied, or supplied by this project.

```sh
npm ci
npm run setup
npm run infra:build
npm run infra:up
npm run db:migrate
codex login
npm run test:ai
npm run dev
```

Open http://127.0.0.1:3000. The API listens on 127.0.0.1:4000, the owned Gather demo on 127.0.0.1:4174, and PostgreSQL on 127.0.0.1:5433. The dashboard and worker must remain running for scheduled jobs.

On a fresh installation, create the owner in the setup screen using `SETUP_TOKEN` from the locally generated `.env`. When the verification script initializes the installation, its owner credentials are stored in `.local/owner.json`, readable only by the local OS user. Do not commit or share `.env`, `.local`, credentials, screenshots, or traces.

`npm run setup` preserves existing configuration. Stopping the development command leaves the database and demo containers running. `docker compose stop` stops this project's services while preserving its database volume. Do not use `down -v` unless you intend to erase local project data.

## Demonstrate the product

1. Connect the **Gather** owned demo, which includes six requirements and 22 clearly labelled authored scenarios.
2. In the project, choose the `alex` discovery role and analyze the application. Examine the observed pages and controls.
3. Generate five new scenarios. The provider receives requirements, observations, role names, and focus text. Login passwords are excluded.
4. Inspect each scenario's requirements, actions, and assertions. Edit any incorrect draft and approve its exact current version.
5. Run the approved regression against the fixed build. Open an individual case's evidence.
6. Enable the known defects and run again. The demo introduces profile persistence, empty-post validation, and unauthorized edit-button visibility defects.
7. Switch to the fixed build and rerun. Previous failed reports retain their original results and scenario snapshots.
8. Create a suite and schedule, or connect a local Git repository to propose regression coverage from changed paths.

For a repeatable authored baseline, use `npm run test:integration -- browser`. This selects only the 22 authored examples so that later AI drafts do not silently change the presentation baseline.

## Implemented capabilities

| Area                | Local implementation                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts            | Owner, maintainer and viewer roles; Argon2 passwords; HTTP-only sessions; CSRF and Origin checks                                          |
| Projects            | Approved target URLs/origins, encrypted login references, project requirements                                                            |
| Discovery           | Bounded Chromium navigation; observed headings, labels, controls and test IDs; optional guided DSL steps through the API                  |
| AI                  | Real structured generation using the user's signed-in local provider; source validation; drafts requiring review                          |
| Scenario management | Authored and generated cases; immutable versions; hash-bound approval; history; archive; CSV export                                       |
| Regression          | Frozen suites/manifests; durable queue; idempotent submission; cancellation; bounded safe retries; separate lifecycle and verdict         |
| Evidence            | Actual per-step assertions and errors, masked password fields in screenshots, optional traces, authenticated downloads, HTML/JSON reports |
| Change analysis     | Owner-selected local Git repository; explicit module/path mappings; full-suite fallback for shared/unmapped files                         |
| Scheduling          | Five-field cron and IANA timezones; durable fire identity; overlap/missed-fire handling; pause/resume                                     |
| Usage               | Browser minutes and AI-request reservations/ledger, storage limits, project/schedule allowances                                           |
| Billing             | Explicit demo plan and subscription-state simulation; no real charges or payment integration                                              |
| Isolation           | PostgreSQL tenant RLS; dedicated queue role; non-root disposable browser containers on an internal network; signed target proxy           |
| Presentation demo   | Synthetic accounts, fixture namespace per attempt, controlled fixed/buggy builds                                                          |

## Architecture and scaling

`apps/web` is React/Vite. `apps/api` is a Fastify API using shared Zod contracts. `apps/worker` dispatches pg-boss jobs through a transactional outbox. Domain logic lives in `packages/domain`, inference in `packages/ai`, and the constrained browser interpreter in `packages/runner`. `packages/db` owns SQL schema and migrations.

PostgreSQL stores durable state and immutable evidence references. Local artifact bytes live in `.local/artifacts`. The runtime database role cannot bypass tenant policies; organization context comes from an authenticated membership. A separate database role owns the queue. Schema changes use the administrative connection only during migration.

The local dispatcher uses a database leader lease, two browser slots, one AI slot, and serial execution within each environment to reduce shared-account interference. Jobs survive an API restart. Interrupted browser writes are marked inconclusive after a worker restart and are not blindly replayed. Newly queued work can resume. Demo fixture cleanup uses persisted attempt/discovery IDs. Evidence expires after 30 days; the worker removes expired files. Summary records currently remain until the installation is explicitly maintained.

This is deliberately a single-machine deployment, not a horizontally scaled SaaS. Commercial deployment requires a separate inference provider per customer/organization, hosted identity, object storage, verified payments/webhooks, production secret management, backup/restore exercises, retention controls, audited network isolation, and worker pools with distributed environment leases. The domain boundaries support that migration; it has not been load-tested as a hosted service.

## Local inference adapter

The adapter runs an ephemeral Codex app-server connection with `gpt-5.5` by default, empty execution environments/workspace roots, read-only sandbox policy, no approvals, disabled action capabilities, and structured output. `CODEX_BIN` and `CODEX_MODEL` can be configured locally. A readiness probe checks the exposed capability inventory; changing versions/models can require revalidation. Account entitlements and limits still apply.

The installed runtime exposes some read-only catalog and user-input tool definitions even with action features disabled. The adapter rejects tool requests/items and discards generation on an attempted tool call. The readiness inventory is model-reported and is not a formal sandbox proof. This local adapter is intended for the owner's development workflow; it is not a credential-sharing or hosted multi-customer inference service. See the official [Codex non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

AI drafts are never accepted as test results. Only the browser interpreter assigns assertion outcomes. A retry pass is `flaky` and yields an inconclusive overall verdict. Cancellation, cleanup failure, missing assertions, execution failures, or a changed expected build cannot yield a clean pass.

## Current boundaries

- Chromium and web applications only. The runner uses the official Playwright 1.64.0 Ubuntu Noble image and its matching bundled browser, with the browser sandbox enabled. Browser compatibility must be rechecked on upgrades. Mobile apps, desktop apps, cross-browser matrices, file uploads, arbitrary JavaScript, CAPTCHA/MFA, and live recording are outside this interpreter's current DSL.
- Customers must supply requirements and test accounts. Discovery sees reachable pages for the selected role; it cannot infer all business rules or hidden workflows.
- External application cleanup must be expressed in reviewed scenario steps. Automatic fixture provisioning is implemented for the owned demo only. Use disposable test accounts and data for other applications.
- Build identity is verified for the owned demo. Other targets currently report `unverified`; local Git analysis does not establish which commit is deployed.
- Schedules operate while the local worker is running. GitHub webhooks, CI adapters, real billing, email invitations, and cloud deployment are not configured.
- Evidence can contain application data. Use synthetic data and inspect artifacts before sharing; traces may contain DOM/network details despite password screenshot masking.
- The egress proxy supports HTTP/HTTPS with exact approved origins and public IPv4 DNS. It blocks private infrastructure addresses, unapproved destinations, and WebSocket upgrades. Some real-time applications will need additional supported transport work.

## Verification

```sh
npm test                         # domain invariants
npm run build                    # TypeScript and production frontend build
npm run test:ai                  # authenticated provider readiness
npm run test:integration -- api  # sessions, permissions, RLS and approval checks
npm run test:integration -- ai   # live discovery and new AI drafts
npm run test:integration -- browser  # fixed → buggy → fixed regression
npm run test:controls            # versioning, Git, quota, cancellation and scheduling
npm run test:network             # actual internal-network and proxy restrictions
npm run test:ui                  # desktop/mobile UI with installed Chrome
```

The integration scripts mutate only this local installation and its owned demo. Verification reports and screenshots are written under `.local`. Tests create synthetic viewer users, approved demo cases and regression history. The UI test accepts `UI_BROWSER_PATH` for an installed Chromium browser on another OS.

See [the MVP verification report](docs/MVP_Verification_Report.md) for measured results, presentation links, AI review corrections, and the commercial release boundaries.

A second owned application, [Parcel](https://github.com/Muthuram05/parcel-regression-demo), has three open demonstration PRs. See [the Parcel connection and PR guide](docs/Parcel_PR_Demo.md) for the correct fix, intentional regression, new feature, and local preview commands.

The original specification and technical design are in `docs/`. This README records the implemented local scope and known differences from the broader product design. Use actual verification output when presenting results.
