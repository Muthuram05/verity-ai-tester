import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { validateCase, verdict } from "../packages/contracts/index.js";
import {
  hash,
  encrypt,
  decrypt,
  targetURL,
  csv,
} from "../packages/domain/security.js";
import { demoCases } from "../packages/domain/demo.js";
const req = Object.fromEntries(
  [
    "Authentication",
    "Profile",
    "Posts",
    "Search",
    "Discussion",
    "Permissions",
  ].map((k) => [k, randomUUID()]),
);
test("presentation scenarios contain real assertions and six workflows", () => {
  const cases = demoCases(req);
  assert.equal(cases.length, 22);
  assert.equal(new Set(cases.map((c) => c.module)).size, 6);
  cases.forEach(validateCase);
});
test("rejects unbounded, executable, and assertion-free definitions", () => {
  const c = demoCases(req)[0];
  assert.throws(() =>
    validateCase({
      ...c,
      steps: [
        {
          op: "evaluate",
          target: null,
          value: 'fetch("https://evil.test")',
          path: null,
        },
      ],
    }),
  );
  assert.throws(() =>
    validateCase({
      ...c,
      steps: c.steps.filter((s) => !s.op.startsWith("assert")),
    }),
  );
  assert.throws(() =>
    validateCase({
      ...c,
      steps: [
        { op: "navigate", path: "//evil.test", value: null, target: null },
        ...c.steps,
      ],
    }),
  );
});
test("canonical hashes survive PostgreSQL JSON key ordering", () =>
  assert.equal(
    hash({ z: 1, a: { b: 2, a: 3 } }),
    hash({ a: { a: 3, b: 2 }, z: 1 }),
  ));
test("encryption detects changed ciphertext and does not persist plain secrets", () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const value = { password: "a-sensitive-password" };
  const enc = encrypt(value);
  assert(!JSON.stringify(enc).includes(value.password));
  assert.deepEqual(decrypt(enc), value);
  enc.data = (enc.data[0] === "a" ? "b" : "a") + enc.data.slice(1);
  assert.throws(() => decrypt(enc));
});
test("verdict never treats retries, empty suites or interruption as a clean pass", () => {
  assert.equal(verdict(["passed"], true), "passed");
  assert.equal(verdict(["passed", "failed"], true), "failed");
  for (const value of ["flaky", "blocked", "skipped", "errored", "cancelled"])
    assert.equal(verdict([value], true), "inconclusive");
  assert.equal(verdict([], true), "inconclusive");
  assert.equal(verdict(["passed"], false), "inconclusive");
  assert.equal(verdict(["passed"], true, false), "inconclusive");
});
test("target policy rejects embedded credentials and infrastructure ports", () => {
  for (const value of [
    "file:///etc/passwd",
    "http://user:pass@example.test",
    "http://127.0.0.1:5433",
    "http://127.1:4000",
    "http://169.254.169.254",
    "http://[::1]:4000",
  ])
    assert.throws(() => targetURL(value));
  assert.equal(
    targetURL("http://127.0.0.1:8080").origin,
    "http://127.0.0.1:8080",
  );
  assert.equal(targetURL("https://example.com").origin, "https://example.com");
});
test("CSV export neutralizes spreadsheet formulas and embedded quote delimiters", () => {
  assert.equal(csv("=1+2"), '"\'=1+2"');
  assert.equal(csv('a"b'), '"a""b"');
});
