import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createProjectVerifier,
  discoverProjectVerification,
} from "../src/project-verification.js";

function temporaryProject(): string {
  return mkdtempSync(join(tmpdir(), "agentic-tcr-project-"));
}

function config(checks: unknown) {
  return { verification: { checks } };
}

test("discovers dedicated project configuration and executes project checks", async () => {
  const root = temporaryProject();

  try {
    writeFileSync(join(root, "agentic-tcr.config.json"), JSON.stringify(config([
      { name: "project-check", command: "project-tool", args: ["check"], cwd: ".", timeoutMs: 5000 },
    ])));
    const calls: string[] = [];
    const discovered = discoverProjectVerification(root);
    const configured = createProjectVerifier(root, {}, async (check) => {
      calls.push(`${check.name}:${check.cwd}`);
      return { exitCode: 0, stdout: "ok", stderr: "" };
    });
    const result = await configured.verifier({ id: "mutation-project" });

    assert.equal(discovered.status, "FOUND");
    if (discovered.status === "FOUND") {
      assert.equal(discovered.checks[0].cwd, root);
      assert.equal(discovered.checks[0].args[0], "check");
    }
    assert.deepEqual(calls, [`project-check:${root}`]);
    assert.equal(result.status, "PASS");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit configuration takes precedence over the project default", () => {
  const root = temporaryProject();

  try {
    writeFileSync(join(root, "agentic-tcr.config.json"), JSON.stringify(config([
      { name: "dedicated", command: "dedicated", args: [] },
    ])));
    writeFileSync(join(root, "custom.json"), JSON.stringify(config([
      { name: "explicit", command: "explicit", args: [] },
    ])));

    const discovered = discoverProjectVerification(root, { configPath: "custom.json" });

    assert.equal(discovered.status, "FOUND");
    if (discovered.status === "FOUND") {
      assert.equal(discovered.checks[0].name, "explicit");
      assert.equal(discovered.sourcePath, join(root, "custom.json"));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("falls back to package.json agenticTcr configuration", () => {
  const root = temporaryProject();

  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "fixture",
      agenticTcr: config([{ name: "package-check", command: "fixture", args: ["verify"] }]),
    }));

    const discovered = discoverProjectVerification(root);

    assert.equal(discovered.status, "FOUND");
    if (discovered.status === "FOUND") {
      assert.equal(discovered.checks[0].name, "package-check");
      assert.equal(discovered.sourcePath, join(root, "package.json"));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing configuration fails closed with actionable feedback", async () => {
  const root = temporaryProject();

  try {
    const configured = createProjectVerifier(root);
    const result = await configured.verifier({ id: "mutation-missing" });

    assert.equal(configured.configuration.status, "MISSING");
    assert.equal(result.status, "FAIL");
    assert.match(result.feedback ?? "", /No project verification configuration/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid configuration fails closed without running arbitrary commands", async () => {
  const root = temporaryProject();
  let runCount = 0;

  try {
    writeFileSync(join(root, "agentic-tcr.config.json"), JSON.stringify(config([
      { name: "invalid", command: "", args: "not-an-array" },
    ])));
    const configured = createProjectVerifier(root, {}, async () => {
      runCount += 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const result = await configured.verifier({ id: "mutation-invalid" });

    assert.equal(configured.configuration.status, "INVALID");
    assert.equal(result.status, "FAIL");
    assert.equal(runCount, 0);
    assert.match(result.feedback ?? "", /verification\.checks\[0\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
