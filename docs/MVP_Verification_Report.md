# Verity MVP verification report

Verified on 9 October 2026 on this Mac, using the owned Gather demo and synthetic accounts. The local MVP's discovery → AI drafts → review → approval → isolated browser execution → evidence workflow is working. These results establish the tested local behavior; they do not establish complete coverage of arbitrary applications or readiness for a hosted commercial launch.

## Run the presentation

Open [Verity](http://127.0.0.1:3000). The owner email is `owner@verity.local`; the generated password is in the private `.local/owner.json` file. The dashboard, API, worker, PostgreSQL, target demo, and target proxy are configured locally. Keep `npm run dev` running for execution and schedules.

1. Open **Gather community** under Projects. The application map contains four discovered authenticated pages.
2. Open Scenarios. There are 22 authored examples and five reviewed scenarios originating from a real AI generation. Generated originals remain in version history when edited.
3. Open the passing fixed-build report, then the buggy-build report below. Inspect an actual failed assertion, its screenshot, and its downloadable trace.
4. Open the repaired-build report to show that the same 22 scenarios pass while the earlier failures remain unchanged.
5. Open the reviewed AI run to show that generated and approved scenarios execute through the same browser runner.
6. For another demonstration, use **Enable known defects**, run the approved scenarios, switch back to the fixed build, and rerun. The baseline verification command selects only the 22 authored examples.

## Verified browser results

| Run                         | Actual result                                                       | Link                                                                         |
| --------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Fixed authored baseline     | 22 passed, 0 failed; build verified                                 | [Open run](http://127.0.0.1:3000/#runs/007f9729-4366-4480-a1b2-1d668e29d94f) |
| Deliberately buggy baseline | 18 passed, 4 failed; build verified; screenshots and traces saved   | [Open run](http://127.0.0.1:3000/#runs/9e261a73-6097-4d0b-9420-4338b3c7b448) |
| Repaired authored baseline  | 22 passed, 0 failed; prior failed report preserved                  | [Open run](http://127.0.0.1:3000/#runs/6127c473-c38d-4efb-9069-fc7d76d81afc) |
| Reviewed AI scenarios       | 5 passed, 19 successful assertions, 5 screenshots; cleanup complete | [Open run](http://127.0.0.1:3000/#runs/b484575a-0c97-4e36-a977-e1eedd0fc5ae) |

The four expected failures were profile name persistence, profile biography persistence, empty-post validation, and visibility of another author's edit button. These were real browser assertion failures against controlled demo defects. No outcomes were supplied by the language model.

## AI generation and review

The authenticated local provider generated five new drafts with `gpt-5.5`, using four discovered pages, project requirements, and account role names. This installation uses the owner's existing local authentication; no API key is supplied or shared by the project. Inference requires internet access and remains subject to the owner's account limits.

All five drafts were confirmed unapproved and source-linked before review. One draft used the wrong element and punctuation for the no-match search message; its next version targets the status message and asserts the required `No posts found` text. Another draft's module was changed from Feed to the existing Posts module. The other three definitions needed no changes. Approval was bound to the exact reviewed versions and hashes. The original AI definitions were preserved.

This is evidence that review is necessary: generated scenarios are proposals, and discovered behavior alone does not determine the correct expected result.

## Platform checks

| Area                          | Result                                                                                                                                                                                                                    | Evidence under `.local/`                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Domain invariants             | 7 tests passed: constrained DSL, assertions, canonical hashes, authenticated encryption, verdict rules, target policy, CSV escaping                                                                                       | `npm test`                                      |
| Build                         | TypeScript validation and Vite production build passed                                                                                                                                                                    | `npm run build`                                 |
| API and access                | 10 checks passed, including sessions, CSRF, Origin checks, viewer permissions, tenant RLS, immutable versions, approvals, entitlement enforcement and exports                                                             | `verification-api.json`                         |
| Full browser cycle            | Fixed → buggy → fixed behavior, idempotency, verified demo build, preserved failed history and report export passed                                                                                                       | `verification-browser.json`                     |
| Live discovery and generation | Four authenticated pages discovered and five real AI drafts saved                                                                                                                                                         | `verification-ai.json`, `generated-review.json` |
| Reviewed AI execution         | Five reviewed cases passed with 19 assertions                                                                                                                                                                             | `verification-generated.json`                   |
| Workflow controls             | 9 checks passed: requirement invalidation, version conflicts, reservations, Git module selection/fallback, immutable suites, schedule validation/pause, cancellation, actual scheduled execution, immutable run manifests | `verification-controls.json`                    |
| Worker interruption           | Existing fixture confirmed before interruption; restart marked work inconclusive, removed that fixture and released the reservation without replaying writes                                                              | `verification-recovery.json`                    |
| Network restrictions          | 6 checks passed: proxy authentication, approved target access, blocked infrastructure, metadata and unapproved origins, and blocked direct internet access                                                                | `verification-network.json`                     |
| UI and evidence               | 7 dashboard routes plus 3 real regression detail views passed; images decoded and trace downloads were ZIP files; no JavaScript errors; 390px mobile overview had no page overflow                                        | `verification-ui.json`, `screenshots/`          |
| Final service state           | Database connected, worker healthy, provider authenticated; Git full-suite fallback selected all 27 approved scenarios                                                                                                    | `verification-final-health.json`                |

Desktop regression evidence and the mobile overview were also visually inspected. The owned demo is left on its fixed build. Verification schedules are paused. Earlier unsuccessful runner attempts remain in history as failed/inconclusive evidence; they are not relabelled as successful runs.

## Runtime corrections verified during testing

- Replaced the incompatible Alpine browser attempt with the official Playwright 1.64.0 Ubuntu Noble image and its matching Chromium 156.0.8078.4 browser.
- Retained a non-root browser, Chromium sandbox, read-only container filesystem, dropped capabilities, resource limits, an internal network and signed target proxy. The seccomp profile allows Chromium to enter its own namespace and chroot there.
- Fixed demo fixture creation to use the persisted attempt/discovery ID. Strengthened the recovery check to prove that the fixture exists before testing its removal.
- Strengthened generation verification to refresh after completion and assert that every generated ID resolves to an actual draft, avoiding an empty-array assertion during a concurrent read.

## Local scope and commercial next steps

Implemented feature areas include project connection, encrypted test-account access, requirements, browser discovery, real AI generation, versioned review/approval, regression execution, screenshots/traces, exports, Git impact selection, scheduling, role-based access, usage quotas and demo subscription controls. The implementation and startup commands are documented in [README](../README.md).

The current dispatcher is a single-machine service with two browser slots and one AI slot. PostgreSQL separates application data, queue ownership and tenant policies. Hosted scalability has not been load-tested. Before public release, add hosted identity, a supported per-organization inference arrangement, distributed worker/environment leases, object storage, production secret management, backup/restore validation, real billing/webhooks, retention administration and deployment monitoring.

External targets need authorized access, test requirements and suitable accounts. Only Chromium web testing is covered; mobile apps, arbitrary JavaScript, uploads, MFA/CAPTCHA, cross-browser matrices and WebSockets remain outside the current runner. Deployed build identity is verified only for the owned demo. A passing selected suite is not a guarantee that the entire connected application is bug-free.
