import {
  existsSync,
  readFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import {
  RepositoryVerifier,
  runVerificationCommand,
  type CommandRunner,
  type VerificationCheck,
  type Verifier,
} from "./verification.js";

export type ProjectVerificationDiscovery =
  | {
    status: "FOUND";
    sourcePath: string;
    checks: readonly VerificationCheck[];
  }
  | {
    status: "MISSING";
    reason: string;
  }
  | {
    status: "INVALID";
    sourcePath: string;
    reason: string;
  };

export type ProjectVerificationOptions = {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
};

export type ConfiguredProjectVerifier = {
  configuration: ProjectVerificationDiscovery;
  verifier: Verifier;
};

/**
 * Discovers project-owned verification configuration.
 *
 * Precedence: explicit option, AGENTIC_TCR_CONFIG, agentic-tcr.config.json,
 * then the `agenticTcr` field in package.json.
 */
export function discoverProjectVerification(
  projectRoot: string,
  options: ProjectVerificationOptions = {},
): ProjectVerificationDiscovery {
  const root = resolve(projectRoot);
  const explicitPath = options.configPath ?? options.env?.AGENTIC_TCR_CONFIG ?? process.env.AGENTIC_TCR_CONFIG;

  if (explicitPath !== undefined) {
    return readConfiguration(root, resolveConfigPath(root, explicitPath), false);
  }

  const dedicatedPath = join(root, "agentic-tcr.config.json");
  if (existsSync(dedicatedPath)) {
    return readConfiguration(root, dedicatedPath, false);
  }

  const packagePath = join(root, "package.json");
  if (existsSync(packagePath)) {
    return readConfiguration(root, packagePath, true);
  }

  return {
    status: "MISSING",
    reason: "No project verification configuration found. Add agentic-tcr.config.json or package.json.agenticTcr.",
  };
}

export function createProjectVerifier(
  projectRoot: string,
  options: ProjectVerificationOptions = {},
  run: CommandRunner = runVerificationCommand,
): ConfiguredProjectVerifier {
  const configuration = discoverProjectVerification(projectRoot, options);

  if (configuration.status === "FOUND") {
    const verifier = new RepositoryVerifier(configuration.checks, run);
    return {
      configuration,
      verifier: verifier.verify.bind(verifier),
    };
  }

  const verifier = new RepositoryVerifier([], run, configuration.reason);
  return { configuration, verifier: verifier.verify.bind(verifier) };
}

function resolveConfigPath(root: string, configPath: string): string {
  return isAbsolute(configPath) ? configPath : resolve(root, configPath);
}

function readConfiguration(
  root: string,
  sourcePath: string,
  fromPackage: boolean,
): ProjectVerificationDiscovery {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(sourcePath, "utf8"));
  } catch (error) {
    return {
      status: "INVALID",
      sourcePath,
      reason: `Unable to read or parse ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const config = fromPackage && isRecord(parsed) ? parsed.agenticTcr : parsed;
  if (!isRecord(config) || !isRecord(config.verification)) {
    if (fromPackage) {
      return {
        status: "MISSING",
        reason: "package.json has no agenticTcr.verification configuration.",
      };
    }
    return { status: "INVALID", sourcePath, reason: "Missing verification object." };
  }

  const checks = config.verification.checks;
  if (!Array.isArray(checks) || checks.length === 0) {
    return { status: "INVALID", sourcePath, reason: "verification.checks must contain at least one check." };
  }

  const normalized: VerificationCheck[] = [];
  for (const [index, candidate] of checks.entries()) {
    const check = normalizeCheck(root, candidate);
    if (typeof check === "string") {
      return {
        status: "INVALID",
        sourcePath,
        reason: `verification.checks[${index}] ${check}`,
      };
    }
    normalized.push(check);
  }

  return { status: "FOUND", sourcePath, checks: normalized };
}

function normalizeCheck(
  root: string,
  candidate: unknown,
): VerificationCheck | string {
  if (!isRecord(candidate)) {
    return "must be an object.";
  }
  if (typeof candidate.name !== "string" || candidate.name.trim() === "") {
    return "name must be a non-empty string.";
  }
  if (typeof candidate.command !== "string" || candidate.command.trim() === "") {
    return "command must be a non-empty string.";
  }
  if (!Array.isArray(candidate.args) || !candidate.args.every((arg) => typeof arg === "string")) {
    return "args must be an array of strings.";
  }
  if (candidate.timeoutMs !== undefined
    && (typeof candidate.timeoutMs !== "number" || !Number.isFinite(candidate.timeoutMs) || candidate.timeoutMs <= 0)) {
    return "timeoutMs must be a positive number.";
  }
  if (candidate.cwd !== undefined && typeof candidate.cwd !== "string") {
    return "cwd must be a string.";
  }

  return {
    name: candidate.name,
    command: candidate.command,
    args: candidate.args,
    cwd: candidate.cwd === undefined ? root : resolve(root, candidate.cwd),
    timeoutMs: candidate.timeoutMs,
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
