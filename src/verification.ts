import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Mutation } from "./mutation.js";

export type VerificationStatus = "PASS" | "FAIL";

export type VerificationCheck = {
  name: string;
  command: string;
  args: readonly string[];
  cwd?: string;
  timeoutMs?: number;
};

export type VerificationCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type VerificationEvidence = {
  mutationId: string;
  checks: readonly VerificationCheckEvidence[];
};

export type VerificationCheckEvidence = VerificationCheck &
  VerificationCommandResult;

export type VerificationResult = {
  status: VerificationStatus;
  feedback?: string;
  evidence?: VerificationEvidence;
};

export type Verifier = (mutation: Mutation) => Promise<VerificationResult>;

export type CommandRunner = (
  check: VerificationCheck,
) => Promise<VerificationCommandResult>;

export const DEFAULT_REPOSITORY_CHECKS: readonly VerificationCheck[] = [
  {
    name: "tests",
    command: "npm",
    args: ["test"],
    timeoutMs: 120_000,
  },
  {
    name: "build",
    command: "npm",
    args: ["run", "build"],
    timeoutMs: 120_000,
  },
];

const execFileAsync = promisify(execFile);

/** Runs one explicitly configured repository command. */
export async function runVerificationCommand(
  check: VerificationCheck,
): Promise<VerificationCommandResult> {
  try {
    const result = await execFileAsync(check.command, [...check.args], {
      cwd: check.cwd,
      timeout: check.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };

    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
    };
  }
}

/**
 * Synchronous-at-the-workflow-boundary repository verifier.
 *
 * Checks run in declaration order and stop at the first failure. The
 * verifier is passive until `verify` is called with a captured mutation;
 * development-time RED states are therefore not workflow failures by
 * themselves.
 */
export class RepositoryVerifier {
  constructor(
    private readonly checks: readonly VerificationCheck[] = DEFAULT_REPOSITORY_CHECKS,
    private readonly run: CommandRunner = runVerificationCommand,
  ) {}

  async verify(mutation: Mutation): Promise<VerificationResult> {
    const checks: VerificationCheckEvidence[] = [];

    for (const check of this.checks) {
      const result = await this.run(check);
      const evidence = { ...check, ...result };
      checks.push(evidence);

      if (result.exitCode !== 0) {
        return {
          status: "FAIL",
          feedback: formatFailureFeedback(evidence),
          evidence: { mutationId: mutation.id, checks },
        };
      }
    }

    return {
      status: "PASS",
      evidence: { mutationId: mutation.id, checks },
    };
  }
}

function formatFailureFeedback(check: VerificationCheckEvidence): string {
  const output = check.stderr.trim() || check.stdout.trim() || "no command output";
  return `Verification check "${check.name}" failed with exit code ${check.exitCode}: ${output}`;
}
