import test from "node:test";
import assert from "node:assert/strict";

import {
  RepositoryVerifier,
  type VerificationCheck,
  type VerificationCommandResult,
} from "../src/verification.js";

const mutation = { id: "mutation-verification-1" };

function check(name: string): VerificationCheck {
  return { name, command: "fixture", args: [name] };
}

test("repository verifier returns PASS evidence for every configured check", async () => {
  const checks = [check("tests"), check("build")];
  const calls: string[] = [];
  const run = async (configured: VerificationCheck): Promise<VerificationCommandResult> => {
    calls.push(configured.name);
    return { exitCode: 0, stdout: `${configured.name} passed`, stderr: "" };
  };

  const result = await new RepositoryVerifier(checks, run).verify(mutation);

  assert.equal(result.status, "PASS");
  assert.deepEqual(calls, ["tests", "build"]);
  assert.deepEqual(result.evidence, {
    mutationId: "mutation-verification-1",
    checks: [
      { ...checks[0], exitCode: 0, stdout: "tests passed", stderr: "" },
      { ...checks[1], exitCode: 0, stdout: "build passed", stderr: "" },
    ],
  });
});

test("repository verifier stops at the first failure with actionable evidence", async () => {
  const checks = [check("tests"), check("build")];
  const calls: string[] = [];
  const run = async (configured: VerificationCheck): Promise<VerificationCommandResult> => {
    calls.push(configured.name);
    return configured.name === "tests"
      ? { exitCode: 1, stdout: "", stderr: "one assertion failed" }
      : { exitCode: 0, stdout: "build passed", stderr: "" };
  };

  const result = await new RepositoryVerifier(checks, run).verify(mutation);

  assert.equal(result.status, "FAIL");
  assert.deepEqual(calls, ["tests"]);
  assert.match(result.feedback ?? "", /tests.*exit code 1.*one assertion failed/);
  assert.deepEqual(result.evidence, {
    mutationId: "mutation-verification-1",
    checks: [
      { ...checks[0], exitCode: 1, stdout: "", stderr: "one assertion failed" },
    ],
  });
});

test("verification does not run until a captured mutation is submitted", async () => {
  let runCount = 0;
  const run = async (): Promise<VerificationCommandResult> => {
    runCount += 1;
    return { exitCode: 0, stdout: "pass", stderr: "" };
  };
  const verifier = new RepositoryVerifier([check("tests")], run);

  assert.equal(runCount, 0);
  await verifier.verify(mutation);
  assert.equal(runCount, 1);
});
