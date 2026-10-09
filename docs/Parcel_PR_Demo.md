# Parcel: three pull requests for a regression demonstration

[Verity source](https://github.com/Muthuram05/verity-ai-tester) and [Parcel source](https://github.com/Muthuram05/parcel-regression-demo) are separate public repositories. Parcel is an owned stationery checkout demo with no real customers, orders or payments.

| PR                                                                                                    | Change                                                                         | Preview               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------- |
| [DEMO-101: Correct bug fix](https://github.com/Muthuram05/parcel-regression-demo/pull/1)              | Make delivery free at exactly ₹1,000 after discounts                           | http://127.0.0.1:4181 |
| [DEMO-102: Intentionally regressing fix](https://github.com/Muthuram05/parcel-regression-demo/pull/2) | Accept whitespace around promotion codes, but incorrectly change SAVE10 to 20% | http://127.0.0.1:4182 |
| [DEMO-103: New feature](https://github.com/Muthuram05/parcel-regression-demo/pull/3)                  | Optional gift wrapping for ₹75, shown separately in the total                  | http://127.0.0.1:4183 |

All PRs target `main` independently and remain unmerged. PR 2 is deliberately incorrect; its failing checks are the expected demonstration result. Main is available at http://127.0.0.1:4180.

## Use the connected project

Open **Parcel checkout** in Verity. Its Environment selector chooses main or one of the three previews for discovery and the project's **Run regression** button. The source repository is connected for local Git change analysis, and live browser discovery has observed the checkout controls.

Seven baseline scenarios are approved. Four additional acceptance scenarios are clearly named DEMO-101, DEMO-102 or DEMO-103 and normally stay in draft: the feature or fix is not present on every branch. The verification command explicitly selects the baseline plus that branch's acceptance cases, approves the reviewed authored definitions for the run, and returns acceptance cases to draft afterward. Their recorded run evidence remains immutable.

The Scenario library's run action and the Changes screen currently use the project's first environment. Use the project page to select a PR preview, or the verification command for the exact branch suites below. A default full run covers approved cases only.

The starting app has two known defects: the delivery threshold excludes exactly ₹1,000 and promotion codes do not trim whitespace. The baseline suite does not claim to cover those edges; the respective PRs add their acceptance checks. The feature branch retains the pre-existing delivery issue. This separation makes introduced regressions distinguishable from unrelated, existing defects.

## Recreate locally

Start Verity using the main README, including the database and browser infrastructure. From the Verity repository:

```sh
git clone https://github.com/Muthuram05/parcel-regression-demo.git demo-project
npm run demo:parcel
```

The preview command creates three Git worktrees under `.local/parcel-previews` when absent and runs the four servers. Keep that terminal open. On an existing clone, fetch remote changes first and update branches deliberately; the command does not reset local work. Do not start a second copy while these ports are already in use.

In another terminal, with Verity's local owner configured:

```sh
npm run demo:parcel:connect
npm run demo:parcel:verify
```

The connection helper uses the verification owner's private `.local/owner.json`, creates the project/environments/requirements/scenarios through the authenticated API, and connects the local repository. `PARCEL_REPO_PATH` overrides the checkout path. Source and branch previews must be trusted, owned code.

## What the checks establish

GitHub Actions runs the unit suite on pushes and PRs. Verity runs actual Chromium containers against the local previews, storing assertions, screenshots and traces. The local verification script compares each preview's reported Git revision before and after the run. Verity's general external-target build identity still displays `unverified`; this demo does not implement hosted deployment attestation or automatic GitHub-to-Verity webhooks.

Expected unit results: DEMO-101 9/9 passing; DEMO-102 6/8 passing with two intentional discount failures; DEMO-103 12/12 passing. Expected browser results: main 7/7, DEMO-101 8/8, DEMO-102 6/8 with the same two regressions, DEMO-103 9/9. Actual browser run IDs and assertions are saved in `.local/verification-parcel.json` when verification completes.

## Verified browser runs

Verified on 9 October 2026, with screenshots and traces for each attempt.

| Branch                            | Passed | Expected failures | Local report                                                                 |
| --------------------------------- | ------ | ----------------- | ---------------------------------------------------------------------------- |
| `main`                            | 7      | 0                 | [Open run](http://127.0.0.1:3000/#runs/933063d7-7da7-421a-99fa-a839b4acd5a0) |
| `demo-101-free-delivery-boundary` | 8      | 0                 | [Open run](http://127.0.0.1:3000/#runs/770374bb-95aa-4a15-8e50-81e5a62bac66) |
| `demo-102-promo-normalization`    | 6      | 2                 | [Open run](http://127.0.0.1:3000/#runs/e35ed98f-a449-45b0-8064-8c5ef6d94742) |
| `demo-103-gift-wrapping`          | 9      | 0                 | [Open run](http://127.0.0.1:3000/#runs/eaa5e5b4-bf85-4947-8b9e-3631289ba392) |

[Open the connected Parcel project](http://127.0.0.1:3000/#projects/15bc8960-9d1d-4411-b68f-15f1237b26b4). The deliberately bad PR remains open and unmerged.
