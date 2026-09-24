import {
  MutationScopeGuard,
  type ExecutionContext,
  type Mutation,
} from "./mutation.js";
import {
  createProjectVerifier,
  type ConfiguredProjectVerifier,
} from "./project-verification.js";
import type { VerificationResult, Verifier } from "./verification.js";
import { resolve } from "node:path";
import { OpenCodeMutationCapture } from "./opencode-mutation-capture.js";
import {
  runWorkflow,
  type RuntimeAdapter,
  type WorkflowResult,
} from "./workflow.js";

export type OpenCodeTcrSession = {
  sessionId: string;
  context: ExecutionContext;
  scopeGuard: MutationScopeGuard;
};

export type OpenCodeVerifiedMutation = {
  mutation: Mutation;
  verification: VerificationResult;
};

export type OpenCodeSessionInfo = {
  id?: string;
  directory?: string;
  worktree?: string;
};

export type OpenCodeSessionLifecycleEvent = {
  type?: string;
  properties?: {
    info?: OpenCodeSessionInfo;
    sessionID?: string;
    file?: string;
  };
};

export type OpenCodeTcrPluginState = {
  projectRoot: string;
  configuration: ConfiguredProjectVerifier["configuration"];
  verifier: Verifier;
  sessions: ReadonlyMap<string, OpenCodeTcrSession>;
  mutationCapture: OpenCodeMutationCapture;
  initializeSession(sessionId: string, info?: OpenCodeSessionInfo): OpenCodeTcrSession;
  nextMutationContext(sessionId: string): ExecutionContext;
  getSession(sessionId: string): OpenCodeTcrSession | undefined;
  handleEvent(event: OpenCodeSessionLifecycleEvent): OpenCodeTcrSession | undefined;
  captureAndVerify(
    sessionId: string,
    observeMutation: (context: ExecutionContext) => Promise<Mutation>,
  ): Promise<OpenCodeVerifiedMutation | undefined>;
  supervisePendingMutation(
    sessionId: string,
    adapter: RuntimeAdapter,
  ): Promise<WorkflowResult | undefined>;
  disposeSession(sessionId: string): void;
  dispose(): void;
};

export type OpenCodeTcrPluginOptions = {
  verifier?: Verifier;
};

export function createOpenCodeTcrPluginState(
  projectRoot: string,
  options: OpenCodeTcrPluginOptions = {},
): OpenCodeTcrPluginState {
  const resolvedProjectRoot = resolve(projectRoot);
  const configured = createProjectVerifier(resolvedProjectRoot);
  const verifier = options.verifier ?? configured.verifier;
  const sessions = new Map<string, OpenCodeTcrSession>();
  const mutationCapture = new OpenCodeMutationCapture();

  return {
    projectRoot: resolvedProjectRoot,
    configuration: configured.configuration,
    verifier,
    sessions,
    mutationCapture,
    initializeSession(sessionId, info = {}) {
      const existing = sessions.get(sessionId);
      if (existing !== undefined) {
        return existing;
      }

      const workspaceId = info.directory === undefined
        ? resolvedProjectRoot
        : resolve(info.directory);
      const scopeId = info.worktree === undefined
        ? workspaceId
        : resolve(info.worktree);
      const session: OpenCodeTcrSession = {
        sessionId,
        context: {
          executionId: `opencode:${sessionId}`,
          workspaceId,
          scopeId,
          sequence: 1,
        },
        scopeGuard: new MutationScopeGuard(),
      };
      sessions.set(sessionId, session);
      return session;
    },
    nextMutationContext(sessionId) {
      const session = sessions.get(sessionId);
      if (session === undefined) {
        throw new Error(`Unknown OpenCode session ${sessionId}`);
      }
      const context = {
        ...session.context,
        sequence: session.context.sequence + 1,
      };
      sessions.set(sessionId, { ...session, context });
      return context;
    },
    getSession(sessionId) {
      return sessions.get(sessionId);
    },
    handleEvent(event) {
      const eventSessionId = event.properties?.sessionID;
      if (event.type === "file.edited"
        && eventSessionId !== undefined
        && event.properties?.file !== undefined) {
        mutationCapture.recordFileEdited({
          type: "file.edited",
          properties: { sessionID: eventSessionId, file: event.properties.file },
        });
        return sessions.get(eventSessionId);
      }
      const info = event.properties?.info;
      const sessionId = info?.id ?? event.properties?.sessionID;
      if (sessionId === undefined) {
        return undefined;
      }
      const location = info?.directory ?? info?.worktree;
      if (location !== undefined && !isInProject(resolvedProjectRoot, location)) {
        return undefined;
      }
      if (event.type === "session.error" || event.type === "session.deleted") {
        const session = sessions.get(sessionId);
        sessions.delete(sessionId);
        mutationCapture.clearSession(sessionId);
        return session;
      }
      if (
        event.type === "session.created"
        || event.type === "session.status"
        || event.type === "session.updated"
        || event.type === "session.idle"
      ) {
        return this.initializeSession(sessionId, info);
      }
      return sessions.get(sessionId);
    },
    async captureAndVerify(sessionId, observeMutation) {
      const session = sessions.get(sessionId);
      if (session === undefined) {
        return undefined;
      }
      const mutation = await mutationCapture.captureOnIdle(
        sessionId,
        session.context,
        observeMutation,
      );
      if (mutation === undefined) {
        return undefined;
      }
      return {
        mutation,
        verification: await verifier(mutation),
      };
    },
    async supervisePendingMutation(sessionId, adapter) {
      const session = sessions.get(sessionId);
      if (session === undefined || !mutationCapture.hasPendingMutation(sessionId)) {
        return undefined;
      }

      const result = await runWorkflow(
        session.context,
        adapter,
        verifier,
        { scopeGuard: session.scopeGuard },
      );
      mutationCapture.clearSession(sessionId);
      sessions.set(sessionId, {
        ...session,
        context: { ...session.context, sequence: session.context.sequence + 1 },
      });
      return result;
    },
    disposeSession(sessionId) {
      sessions.delete(sessionId);
      mutationCapture.clearSession(sessionId);
    },
    dispose() {
      sessions.clear();
    },
  };
}

function isInProject(projectRoot: string, location: string): boolean {
  const resolvedLocation = resolve(location);
  return resolvedLocation === projectRoot || resolvedLocation.startsWith(`${projectRoot}/`);
}
