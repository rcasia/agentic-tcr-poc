import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { supervise } from "../src/supervisor.js";
import type { Mutation } from "../src/supervisor.js";

const here = dirname(fileURLToPath(import.meta.url));
const supervisorSource = readFileSync(join(here, "../src/supervisor.ts"), "utf8");
const mutationSource = readFileSync(join(here, "../src/mutation.ts"), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("accepts a mutation when verification passes (existing behavior)", async () => {
  const mutation: Mutation = { id: "mutation-1", description: "change" };

  const decision = await supervise(mutation, async () => ({ status: "PASS" }));

  assert.deepEqual(decision, { type: "ACCEPT", mutation });
});

test("rejects a mutation and returns feedback when verification fails (existing behavior)", async () => {
  const mutation: Mutation = { id: "mutation-1", description: "change" };

  const decision = await supervise(mutation, async () => ({
    status: "FAIL",
    feedback: "tests failed",
  }));

  assert.deepEqual(decision, {
    type: "REJECT",
    mutation,
    feedback: "tests failed",
  });
});

test("preserves generic execution context through ACCEPT", async () => {
  const mutation: Mutation = {
    id: "mutation-2",
    description: "rename helper",
    execution: { executionId: "exec-1", workspaceId: "ws-1", sequence: 3 },
    changes: [{ path: "src/index.ts", additions: 2, deletions: 1 }],
    capturedAt: "2026-09-24T00:00:00.000Z",
  };

  const seen: Mutation[] = [];
  const decision = await supervise(mutation, async (m) => {
    seen.push(m);
    return { status: "PASS" };
  });

  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].execution, mutation.execution);
  assert.deepEqual(seen[0].changes, mutation.changes);
  assert.equal(decision.type, "ACCEPT");
  if (decision.type === "ACCEPT") {
    assert.deepEqual(decision.mutation.execution, {
      executionId: "exec-1",
      workspaceId: "ws-1",
      sequence: 3,
    });
    assert.deepEqual(decision.mutation.changes, [
      { path: "src/index.ts", additions: 2, deletions: 1 },
    ]);
  }
});

test("preserves generic execution context through REJECT", async () => {
  const mutation: Mutation = {
    id: "mutation-3",
    execution: { executionId: "exec-1", sequence: 4 },
    changes: [{ path: "src/a.ts" }, { path: "src/b.ts" }],
  };

  const decision = await supervise(mutation, async () => ({
    status: "FAIL",
    feedback: "type error",
  }));

  assert.equal(decision.type, "REJECT");
  if (decision.type === "REJECT") {
    // Enough correlation for the adapter to restore: id + execution.
    assert.equal(decision.mutation.id, "mutation-3");
    assert.deepEqual(decision.mutation.execution, { executionId: "exec-1", sequence: 4 });
    assert.equal(decision.mutation.changes?.length, 2);
    assert.equal(decision.feedback, "type error");
  }
});

test("minimal mutation without context remains valid (backward compatible)", async () => {
  const mutation: Mutation = { id: "mutation-legacy" };

  const decision = await supervise(mutation, async () => ({ status: "PASS" }));

  assert.deepEqual(decision, { type: "ACCEPT", mutation });
});

test("generic mutation carries no OpenCode-specific keys", () => {
  const mutation: Mutation = {
    id: "mutation-4",
    execution: { executionId: "exec-1", sequence: 1 },
    changes: [{ path: "src/index.ts" }],
  };

  const forbidden = ["messageID", "messageId", "partID", "partId", "sessionId", "sessionID"];
  for (const key of Object.keys(mutation)) {
    assert.ok(!forbidden.includes(key), `Mutation key leaks runtime detail: ${key}`);
  }
  for (const change of mutation.changes ?? []) {
    for (const key of Object.keys(change)) {
      assert.ok(
        !["before", "after", "messageID", "partID"].includes(key),
        `FileChange key leaks runtime detail: ${key}`,
      );
    }
  }
});

test("supervisor and mutation modules do not depend on OpenCode", () => {
  for (const [name, source] of [
    ["supervisor.ts", supervisorSource],
    ["mutation.ts", mutationSource],
  ] as const) {
    const code = stripComments(source);
    assert.ok(
      !/opencode/i.test(code),
      `${name} must not reference OpenCode in code (outside comments)`,
    );
    assert.ok(
      !/from\s+["'][^"']*opencode[^"']*["']/.test(code),
      `${name} must not import a runtime adapter`,
    );
    for (const token of ["messageID", "partID", "sessionId", "abort", "revert"]) {
      assert.ok(
        !code.includes(token),
        `${name} code must not contain runtime token "${token}" (document it in comments instead)`,
      );
    }
  }
});
