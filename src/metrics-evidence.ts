import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type {
  MetricsEvidenceSink,
  PersistedMetricRecord,
} from "./metrics.js";

export class MetricsEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetricsEvidenceError";
  }
}

/** Append-only JSONL persistence for raw per-mutation evaluation evidence. */
export class JsonlMetricsStore implements MetricsEvidenceSink {
  constructor(private readonly filePath: string) {}

  append(record: PersistedMetricRecord): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  read(runId?: string): readonly PersistedMetricRecord[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    return readFileSync(this.filePath, "utf8")
      .split("\n")
      .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
      .filter(({ line }) => line.length > 0)
      .map(({ line, lineNumber }) => parseRecord(line, lineNumber))
      .filter((record) => runId === undefined || record.run.runId === runId);
  }

  exportRun(runId: string): string {
    const records = this.read(runId);
    return records.length === 0
      ? ""
      : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  }

  writeRun(runId: string, destinationPath: string): void {
    writeFileSync(destinationPath, this.exportRun(runId), "utf8");
  }
}

function parseRecord(line: string, lineNumber: number): PersistedMetricRecord {
  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch {
    throw new MetricsEvidenceError(`Malformed metrics evidence at line ${lineNumber}`);
  }

  if (!isPersistedMetricRecord(value)) {
    throw new MetricsEvidenceError(`Invalid metrics evidence at line ${lineNumber}`);
  }

  return value;
}

function isPersistedMetricRecord(value: unknown): value is PersistedMetricRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Partial<PersistedMetricRecord>;
  const run = record.run;
  const measurement = record.measurement;

  return record.schemaVersion === 1
    && typeof record.mutationSequence === "number"
    && typeof run === "object"
    && run !== null
    && typeof run.runId === "string"
    && typeof run.startedAt === "string"
    && typeof measurement === "object"
    && measurement !== null
    && typeof measurement.mutationId === "string"
    && typeof measurement.executionId === "string"
    && typeof measurement.sequence === "number"
    && (measurement.verificationStatus === "PASS" || measurement.verificationStatus === "FAIL");
}
