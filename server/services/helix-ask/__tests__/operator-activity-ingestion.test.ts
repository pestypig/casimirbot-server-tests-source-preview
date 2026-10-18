import { describe, expect, it, vi } from "vitest";
import type { HelixOperatorActivityStore } from "../operator-activity-store";
import {
  appendAgentRunEventsToOperatorActivity,
  appendEnvironmentEventsToOperatorActivity,
  appendMcpToolInvocationToOperatorActivity,
  helixAgentApiNodeRef,
  helixOperatorActivityStreamRef,
} from "../operator-activity-ingestion";
import type {
  HelixAgentRunOwner,
  HelixAgentRunRecord,
} from "../../helix-agent-api/run-store";

const append = vi.fn(async (input: { events: unknown[] }) => ({
  events: input.events,
  replayed: input.events.map(() => false),
}));
const store = { append } as unknown as HelixOperatorActivityStore;

const owner: HelixAgentRunOwner = {
  tenantId: "tenant:one",
  issuer: "https://issuer.example",
  subjectId: "subject:one",
  accountProfileId: "profile:one",
};

const run: HelixAgentRunRecord = {
  runId: "run:one",
  tenantId: owner.tenantId,
  issuer: owner.issuer,
  subjectId: owner.subjectId,
  accountProfileId: owner.accountProfileId,
  objective: "must-not-project",
  objectiveHash: "objective_hash:one",
  runtimeProvider: "helix-ask",
  providerGoalId: "provider-goal-private",
  providerThreadId: "provider-thread-private",
  providerSessionId: "provider-session-private",
  lifecycleStatus: "running",
  completionStatus: "pending",
  terminalAuthorityStatus: "not_evaluated",
  version: 1,
  configuration: {
    completion_contract: {
      min_evidence_refs: 1,
      require_terminal_authority: true,
      required_output_fields: [],
      max_unresolved_requirements: 0,
      allow_conflicts: false,
    },
    constraints: [],
    database_scope: [],
    execution_policy: {
      allowed_tools: [],
      required_evidence: [],
      policy_hash: "policy:one",
    },
  },
  evidenceBundle: {
    schema: "helix.agent_run.evidence_bundle.v1",
    run_id: "run:one",
    observation_refs: [],
    evidence_refs: [],
    receipt_refs: [],
    provider_terminal_candidate_ref: null,
    claims_supported: [],
    claims_contradicted: [],
    unresolved_requirements: [],
    terminal_authority_status: "not_evaluated",
    answer_authority: false,
    assistant_answer: false,
    terminal_eligible: false,
    raw_content_included: false,
  },
  runtimeSnapshot: null,
  latestResult: null,
  latestSummary: null,
  unresolvedRequirements: [],
  contradictions: [],
  pendingQuestions: [],
  maxSteps: 4,
  stepsUsed: 1,
  activeOperationId: null,
  operationStartedAt: null,
  expiresAt: "2026-09-02T20:00:00.000Z",
  createdAt: "2026-09-01T20:00:00.000Z",
  updatedAt: "2026-09-01T20:00:00.000Z",
  completedAt: null,
  cancelledAt: null,
};

describe("operator activity ingestion", () => {
  it("derives environment stream identity from only profile and node", async () => {
    append.mockClear();
    const expected = helixOperatorActivityStreamRef({
      profileId: "profile:one",
      nodeRef: "node:one",
    });
    const result = await appendEnvironmentEventsToOperatorActivity({
      profileId: "profile:one",
      nodeRef: "node:one",
      environmentBindingRef: "binding:one",
      events: [],
      store,
    });
    expect(result.stream_ref).toBe(expected);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      stream: {
        streamRef: expected,
        profileRef: "profile:one",
        nodeRef: "node:one",
      },
    }));
  });

  it("hashes provider identity and omits run content from Agent API activity", async () => {
    append.mockClear();
    const result = await appendAgentRunEventsToOperatorActivity({
      owner,
      run,
      events: [{
        schema: "helix.agent_run.event.v1",
        event_id: "agent_event:one",
        run_id: "run:one",
        seq: 1,
        event_type: "run_started",
        payload: { prompt: "payload-must-not-project" },
        created_at: "2026-09-01T20:00:00.000Z",
        answer_authority: false,
        assistant_answer: false,
        terminal_eligible: false,
        raw_content_included: false,
      }],
      store,
    });
    expect(result.node_ref).toBe(helixAgentApiNodeRef(owner));
    const projected = append.mock.calls.at(-1)?.[0];
    expect(JSON.stringify(projected)).not.toContain("must-not-project");
    expect(JSON.stringify(projected)).not.toContain("provider-thread-private");
    expect(JSON.stringify(projected)).not.toContain("provider-session-private");
    expect(JSON.stringify(projected)).not.toContain("provider-goal-private");
  });

  it("rejects an Agent API owner/profile mismatch", async () => {
    await expect(appendAgentRunEventsToOperatorActivity({
      owner: { ...owner, accountProfileId: "profile:other" },
      run,
      events: [],
      store,
    })).rejects.toThrow("operator_activity_agent_owner_mismatch");
  });

  it("projects only sanitized lifecycle facts for an ordinary MCP tool call", async () => {
    append.mockClear();
    const result = await appendMcpToolInvocationToOperatorActivity({
      owner,
      requestId: "request-with-private-prompt-material",
      toolName: "helix_private_fixture_tool",
      outcome: "succeeded",
      occurredAt: "2026-09-01T20:00:00.000Z",
      observedAt: "2026-09-01T20:00:01.000Z",
      nodeRef: "service_instance:current",
      oauthClientRef: "oauth_client:one",
      clientSessionRef: "mcp_client_session:one",
      store,
    });

    expect(result.capability_call_ref).toMatch(/^mcp_capability_call:/u);
    const projected = append.mock.calls.at(-1)?.[0] as {
      events: Array<Record<string, unknown>>;
    };
    expect(projected.events).toHaveLength(8);
    expect(projected.events.map((event) => event.lifecycle_stage)).toEqual([
      "planned",
      "admitted",
      "dispatched",
      "adapter_acknowledged",
      "result_observed",
      "result_validated",
      "reentered_solver",
      "terminal_considered",
    ]);
    expect(projected.events.every((event) => event.raw_content_included === false))
      .toBe(true);
    expect(JSON.stringify(projected)).not.toContain(
      "request-with-private-prompt-material",
    );
    expect(JSON.stringify(projected)).not.toContain(
      "helix_private_fixture_tool",
    );
  });
});
