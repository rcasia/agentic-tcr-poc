import type { ExecutionContext, Mutation } from "./mutation.js";
import {
  createProjectVerifier,
  type ConfiguredProjectVerifier,
} from "./project-verification.js";
import type { VerificationResult } from "./verification.js";
import {
  runWorkflow,
  type RuntimeAdapter,
  type WorkflowResult,
} from "./workflow.js";

export type DemoOptions = {
  context?: ExecutionContext;
  adapter?: RuntimeAdapter;
  verify?: (mutation: Mutation) => Promise<VerificationResult>;
};

/**
 * In-process demo adapter for `bun run dev` / `npm run dev`.
 *
 * It owns no OpenCode identifiers on purpose: the generic entrypoint must
 * stay free of runtime-specific dependencies (see AGENTS.md). Live OpenCode
 * sessions are driven through `src/opencode-adapter.ts`, not here.
 */
export function createDemoAdapter(captured: Mutation): RuntimeAdapter {
  return {
    async observeMutation(context) {
      return captured.execution === undefined
        ? { ...captured, execution: context }
        : captured;
    },
    async interrupt() {},
    async rejectOrRestore() {},
    async sendFeedback(context) {
      return { context };
    },
  };
}

/** Runs one TCR mutation through the real workflow + verifier boundary. */
export async function runDemo(
  options: DemoOptions = {},
): Promise<WorkflowResult> {
  const context: ExecutionContext = options.context ?? {
    executionId: "poc-execution",
    workspaceId: "poc-workspace",
    scopeId: "poc-scope",
    sequence: 1,
  };
  const captured: Mutation = {
    id: `mutation:${context.executionId}:${context.sequence}`,
    execution: context,
    description: "POC demo mutation",
    changes: [
      { path: "src/index.ts", summary: "wire entrypoint to workflow" },
    ],
    capturedAt: new Date().toISOString(),
  };
  const adapter = options.adapter ?? createDemoAdapter(captured);
  const configuredVerifier: ConfiguredProjectVerifier = createProjectVerifier(process.cwd());
  const verify = options.verify ??
    configuredVerifier.verifier;

  return runWorkflow(context, adapter, verify);
}

export async function main(): Promise<void> {
  console.log("Agentic TCR POC");
  const result = await runDemo();
  if (result.decision.type === "ACCEPT") {
    console.log(`ACCEPT ${result.decision.mutation.id}`);
  } else {
    console.log(`REJECT ${result.decision.mutation.id}`);
    if (result.decision.feedback) {
      console.log(result.decision.feedback);
    }
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("index.ts") || entry.endsWith("index.js")) {
  void main();
}
