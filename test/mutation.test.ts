import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  assertMutationContext,
  MutationScopeGuard,
  type ExecutionContext,
  type FileChange,
  type Mutation,
} from "../src/mutation.js";

const here = dirname(fileURLToPath(import.meta.url));
const mutationSource = readFileSync(join(here, "../src/mutation.ts"), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("execution context models the POC sequential-mutation ordering", () => {
  const first: ExecutionContext = { executionId: "exec-1", sequence: 1 };
  const second: ExecutionContext = {
    executionId: "exec-1",
    workspaceId: "ws-1",
    sequence: 2,
  };

  assert.ok(second.sequence > first.sequence);
  assert.equal(second.executionId, first.executionId);
});

test("scope guard enforces increasing sequence and stable workspace/file scope", () => {
  const guard = new MutationScopeGuard();
  guard.validate({ executionId: "exec-guard", workspaceId: "ws-1", scopeId: "scope-1", sequence: 1 });
  guard.validate({ executionId: "exec-guard", workspaceId: "ws-1", scopeId: "scope-1", sequence: 2 });

  assert.throws(
    () => guard.validate({ executionId: "exec-guard", workspaceId: "ws-1", scopeId: "scope-1", sequence: 2 }),
    /sequence must increase/,
  );
  assert.throws(
    () => guard.validate({ executionId: "exec-guard", workspaceId: "ws-2", scopeId: "scope-1", sequence: 3 }),
    /changed workspace/,
  );
  assert.throws(
    () => guard.validate({ executionId: "exec-guard", workspaceId: "ws-1", scopeId: "scope-2", sequence: 3 }),
    /changed file scope/,
  );
});

test("captured mutation context must match execution identity and sequence", () => {
  const context: ExecutionContext = {
    executionId: "exec-context",
    workspaceId: "ws-1",
    scopeId: "scope-1",
    sequence: 4,
  };
  const mutation: Mutation = {
    id: "mutation-context",
    execution: context,
    changes: [{ path: "src/example.ts" }],
  };

  assert.doesNotThrow(() => assertMutationContext(mutation, context));
  assert.throws(
    () => assertMutationContext(mutation, { ...context, executionId: "exec-other" }),
    /different execution/,
  );
  assert.throws(
    () => assertMutationContext(mutation, { ...context, sequence: 5 }),
    /sequence does not match/,
  );
});

test("mutation retains id + execution + changes for adapter-side restore correlation", () => {
  const mutation: Mutation = {
    id: "mutation-ctx-1",
    description: "captured change",
    execution: { executionId: "exec-9", workspaceId: "ws-9", sequence: 7 },
    changes: [
      { path: "src/index.ts", summary: "rename", additions: 3, deletions: 1 },
      { path: "src/util.ts" },
    ],
    capturedAt: "2026-09-24T00:00:00.000Z",
  };

  // The adapter resolves this generic correlation key to its concrete
  // restore handle (e.g. OpenCode messageID/partID) via a sidecar mapping.
  // The generic model itself carries no runtime handle.
  assert.equal(mutation.id, "mutation-ctx-1");
  assert.equal(mutation.execution?.executionId, "exec-9");
  assert.equal(mutation.execution?.sequence, 7);
  assert.equal(mutation.changes?.length, 2);

  const change: FileChange = mutation.changes?.[0] as FileChange;
  assert.equal(change.path, "src/index.ts");
  assert.equal(change.additions, 3);
});

test("file changes are generic summaries without before/after contents", () => {
  const change: FileChange = { path: "src/a.ts", additions: 1, deletions: 1 };

  assert.deepEqual(Object.keys(change).sort(), ["additions", "deletions", "path"]);
  assert.ok(!("before" in change));
  assert.ok(!("after" in change));
});

test("mutation domain documents omitted adapter-owned fields", () => {
  for (const token of ["messageID", "partID", "sessionId", "OpenCodeClient"]) {
    assert.ok(
      mutationSource.includes(token),
      `mutation.ts should document why "${token}" belongs to the adapter`,
    );
  }

  const code = stripComments(mutationSource);
  assert.ok(!/opencode/i.test(code), "mutation code must not reference OpenCode outside comments");
  assert.ok(
    !/from\s+["'][^"']*opencode[^"']*["']/.test(code),
    "mutation domain must not import a runtime adapter",
  );
  // Omitted runtime handles must not become real type fields.
  assert.ok(!/messageID\s*\??:/.test(code), "messageID must not be a Mutation field");
  assert.ok(!/partID\s*\??:/.test(code), "partID must not be a Mutation field");
  assert.ok(!/sessionId\s*\??:/.test(code), "sessionId must not be a Mutation field");
});
