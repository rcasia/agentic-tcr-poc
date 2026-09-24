# Agentic TCR POC

Proof of concept for the [Agentic TCR Workflow](https://github.com/rcasia/agentic-tcr-workflow-rfc).

## What is this repository?

This repository is an experimental implementation of the Agentic TCR Workflow. Its purpose is to validate the core control loop described by the RFC against a concrete agent runtime.

This is a **POC, not the RFC implementation or a complete production system**. The POC should stay small and make the workflow semantics observable before adding broader runtime or orchestration concerns.

## Source of truth

The normative design reference is the [Agentic TCR Workflow RFC](https://github.com/rcasia/agentic-tcr-workflow-rfc/blob/main/RFC.md).

The POC should validate the RFC rather than redefine it. When implementation details are runtime-specific, they belong in the POC or its adapter rather than in the core workflow semantics.

## What the POC should demonstrate

The essential loop is:

```text
1 agent
   -> 1 workspace
   -> 1 file scope
   -> capture mutation
   -> fast verification
   -> PASS: ACCEPT
   -> FAIL: INTERRUPT SAME EXECUTION
              -> REJECT / RESTORE
              -> FEEDBACK
              -> CONTINUE SAME EXECUTION
```

The important property is **probabilistic execution, deterministic acceptance**: the agent is free to generate and apply changes, but a mutation only becomes accepted progress after passing the verification boundary.

## POC scope

The initial POC deliberately keeps the execution model constrained:

- **One agent execution.**
- **One workspace.**
- **One scope of files.**
- **Sequential mutations.**
- **Fast, synchronous verification.**
- **Same execution context after failure.**
- **Explicit accept/reject behavior.**

Multi-agent coordination is outside the initial POC scope. If multiple agents are introduced later, they should operate in isolated workspaces (for example, separate worktrees) rather than sharing the same workspace concurrently.

## Mutation boundary

A mutation is whatever concrete change the workflow captures from the agent and presents to verification as one unit.

The RFC does not impose a fixed maximum size or require a mutation to correspond to exactly one file. A mutation may span multiple files when that is what the agent changes as one captured unit.

The POC should favor mutations that are **quick to capture, quick to verify, and clear to restore**. A very large mutation is not invalid by itself, but it may be a useful smell because it increases the amount of work that must be verified or restored together.

## Verification

Verification is intentionally part of the tight agent feedback loop. The initial POC should use verification that completes quickly enough to keep the workflow interactive and continuous.

The exact verification toolchain is not prescribed by the RFC. Depending on the POC implementation, verification may include tests, type checking, linting, builds, repository invariants, or other deterministic checks.

## Evaluation Evidence

`EvaluationMetrics` can receive a `JsonlMetricsStore` and run metadata to append
raw per-mutation measurements without changing the workflow's acceptance
decision. `JsonlMetricsStore.read(runId)` inspects persisted records and
`exportRun(runId)` returns one completed run as JSONL. Missing evidence is
reported as an empty collection; malformed records are rejected with a line
number so evidence corruption is visible.

`buildEvaluationReportFromStore()` derives aggregate counts, mutation size,
objective completion, recovery, overhead, and median/P95 latency summaries
from one or more persisted runs while retaining the raw records separately.

## Failure and recovery

When verification fails, the POC should preserve the RFC's failure semantics:

```text
FAIL
  -> INTERRUPT SAME EXECUTION
  -> REJECT / RESTORE
  -> FEEDBACK
  -> CONTINUE SAME EXECUTION
```

`INTERRUPT` means stopping active processing. It does **not** mean destroying the execution context. The agent must be able to continue from the resulting context after the failed mutation has been rejected or restored.

## Runtime integration

If the POC uses a concrete coding-agent runtime such as OpenCode, runtime-specific mechanisms should live in an adapter layer. The adapter is responsible for mapping the RFC's abstract capabilities—such as observing mutations, interrupting execution, restoring rejected changes, and delivering feedback—to the runtime's concrete APIs.

The runtime adapter must not become the source of truth for verification or acceptance. Those remain workflow responsibilities.

### Continuation contract

The POC treats feedback delivery as the continuation capability. The generic
adapter's `sendFeedback()` operation must deliver feedback to the same
execution and resolve with a `RuntimeContinuation` containing that execution
context. The workflow rejects a continuation that changes the execution
identity; no separate runtime-specific `continue` operation is needed.

## What is intentionally out of scope

The initial POC does not attempt to solve:

- multi-agent shared-workspace concurrency;
- distributed supervisors;
- standardized event schemas;
- standardized verification result formats;
- generalized transaction semantics;
- every possible mutation-boundary strategy;
- production-grade orchestration.

These can be explored after the core loop has been demonstrated.

## Relationship to the RFC

The POC is a concrete experiment around the RFC's core invariants:

- mutations cross a verification boundary;
- verification determines acceptance;
- failed mutations do not become accepted durable progress;
- failure interrupts the same active execution;
- feedback returns to that same execution context;
- the agent continues from the resulting context;
- runtime-specific behavior is isolated behind an adapter.

The goal is to learn from the concrete implementation without prematurely expanding the core protocol.
