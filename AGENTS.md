# Agent Guide

## Purpose

This repository is the proof of concept for the Agentic TCR Workflow described by the RFC. Agents are expected to implement individual issues while preserving the architectural boundaries below.

## Source of truth

- RFC: `rcasia/agentic-tcr-workflow-rfc`
- POC: this repository
- Skill: `rcasia/agentic-trc-skill`

The RFC defines the normative workflow. The POC validates that workflow with a concrete OpenCode runtime adapter.

## Architecture boundaries

```text
Agent Runtime
     |
     v
Runtime Adapter  ---> runtime-specific control only
     |
     v
Mutation
     |
     v
Workflow / Supervisor ---> deterministic acceptance
     |
     v
Verifier             ---> PASS / FAIL evidence only
```

### Runtime Adapter

Owns runtime-specific concerns such as execution association, mutation observation, interruption, restoration, and feedback delivery.

**May:** depend on OpenCode APIs and identifiers.

**Must not:** decide PASS/FAIL or acceptance.

### Supervisor / Workflow

Owns the generic control flow and acceptance boundary.

**May:** orchestrate generic interfaces and consume verifier results.

**Must not:** import OpenCode, inspect runtime-specific events, or invent verification heuristics.

### Verifier

Owns verification evidence.

**May:** run repository-local tests, type checks, builds, static checks, or other configured checks.

**Must not:** mutate runtime state, interrupt executions, restore changes, or decide acceptance independently of its PASS/FAIL result.

### Agent

Owns reasoning and implementation of the requested change objective.

**May:** use TDD, including temporary failing tests during development.

**Must not:** self-approve a mutation or bypass the verification boundary.

## POC constraints

The POC intentionally targets:

- one agent;
- one isolated workspace;
- one file scope;
- sequential mutations;
- short, synchronous verification;
- continuation in the same execution context after failure.

Multi-agent concurrency, distributed supervisors, long-running asynchronous verification, and complex transaction semantics are outside the current POC.

## Failure semantics

The normative failure order is:

```text
VERIFY FAIL
  -> INTERRUPT SAME EXECUTION
  -> REJECT / RESTORE
  -> FEEDBACK
  -> CONTINUE SAME EXECUTION
```

Interruption stops active processing; it does not mean destroying the execution context. Runtime-specific mechanisms belong in the adapter.

## Working rules for agents

1. Start from the issue assigned to you and respect its scope.
2. Read the relevant existing code and tests before changing interfaces.
3. Keep generic code free of runtime-specific dependencies.
4. Prefer small, testable changes.
5. Add or update tests for every behavior you introduce.
6. Do not silently expand the POC scope.
7. If an issue requires another issue's contract, document the dependency rather than duplicating the responsibility.
8. Do not change the RFC's normative semantics from the POC without explicitly recording the discrepancy.
9. Treat verification failures as feedback to the same execution, not as a reason to create a new execution.
10. Before considering work complete, run the relevant tests and build.

## Issue ownership map

- **#1** — generic mutation context. No OpenCode API work.
- **#2** — generic workflow/controller. No OpenCode imports.
- **#3** — OpenCode adapter. Runtime-specific details stay here.
- **#4** — verification port and concrete verifier. No runtime control.
- **#5** — end-to-end integration test. Validates the boundaries and normative flow.

## Definition of done

An issue is complete when:

- its acceptance criteria are satisfied;
- tests cover the new behavior;
- existing tests remain green;
- `npm run build` succeeds;
- no responsibility has leaked across the boundaries above;
- the implementation remains within the POC scope.
