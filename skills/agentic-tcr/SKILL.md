# Agentic TCR Workflow Skill

## Purpose

This skill teaches an agent how to operate within the Agentic TCR Workflow during the POC.

The agent remains responsible for reasoning about the change objective and producing mutations. The workflow, not the agent, determines whether a mutation becomes accepted progress.

The normative reference is the [Agentic TCR Workflow RFC](https://github.com/rcasia/agentic-tcr-workflow-rfc).

## POC Operating Model

The POC intentionally uses a simple execution model:

- one agent;
- one workspace;
- one file scope for the change objective;
- sequential mutations;
- immediate, short verification after each captured mutation;
- no multi-agent coordination.

Do not introduce multi-agent concurrency, shared workspaces, or distributed coordination as part of this POC.

## Core Loop

For every mutation produced while working toward the change objective:

1. Produce a concrete mutation.
2. Stop at the mutation boundary so the workflow can capture it.
3. Wait for verification.
4. If verification **PASSES**, continue from the accepted durable state.
5. If verification **FAILS**, stop active work and allow the workflow to interrupt the execution.
6. Do not treat the failed mutation as accepted progress.
7. Read the machine-readable feedback and continue reasoning from the resulting execution context.
8. Produce the next mutation only after the failure has been handled.

The expected failure path is:

```text
FAIL
  |
  v
INTERRUPT SAME EXECUTION
  |
  v
REJECT / RESTORE
  |
  v
FEEDBACK
  |
  v
CONTINUE SAME EXECUTION
```

## Mutation Guidance

A mutation is the concrete change currently being presented to the workflow for verification.

A mutation does not have a prescribed maximum size. Prefer focused changes that can be captured quickly and verified clearly, but do not artificially split a change merely to satisfy a size limit that the POC does not define.

A mutation may touch multiple files within the allowed file scope when those changes form one coherent concrete change.

Do not assume that a mutation is accepted because:

- the code looks correct;
- the requested change appears complete;
- the agent is confident;
- the agent has explained its intent;
- a previous mutation passed.

Only the workflow verification result determines acceptance.

## Verification

Verification is part of the continuous agent loop and should be short enough to keep feedback close to code generation.

The agent must not bypass or weaken verification to make progress.

When verification fails, use the returned evidence to identify the cause and adapt the next mutation. Do not continue building additional unverified work on top of a failed mutation.

## Change Objective

Work toward the requested change objective, but treat the objective as the overall scope rather than as one mutation.

The agent may decompose the objective into smaller steps and produce multiple mutations. Each mutation must independently cross the verification boundary.

Do not declare the objective accepted merely because the agent believes it is complete. Objective completion requires the workflow's configured acceptance conditions to be satisfied.

## Runtime Behavior

The skill is runtime-agnostic.

Do not assume runtime-specific APIs, session identifiers, commands, event formats, or transport mechanisms. Those belong to the runtime adapter.

The agent should assume that the runtime can:

- associate the execution with the workflow;
- interrupt the active execution without losing continuation context;
- deliver verification feedback to the same execution context;
- continue reasoning from the resulting context.

## Rules

**MUST:**

- respect the mutation boundary;
- wait for verification before treating a mutation as progress;
- stop active work when verification fails;
- use failure feedback to guide the next mutation;
- continue from the same execution context after failure;
- stay within the configured workspace and file scope.

**MUST NOT:**

- self-accept a mutation;
- ignore a verification failure;
- continue accumulating changes after a failed mutation before recovery;
- require a new agent execution solely because a mutation failed;
- introduce multi-agent workspace coordination in this POC;
- make the core workflow depend on runtime-specific mechanisms.
