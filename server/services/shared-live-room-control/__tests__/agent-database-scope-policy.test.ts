import { describe, expect, it } from "vitest";
import { HELIX_SHARED_LIVE_ROOM_READ_SCOPE } from "@shared/contracts/helix-shared-live-room-agent.v1";
import {
  HELIX_AGENT_BOUND_ROOM_EVIDENCE_CAPABILITY,
  HELIX_AGENT_BOUND_ROOM_EVIDENCE_DATABASE_SCOPE,
  HELIX_AGENT_BOUND_ROOM_EVIDENCE_REQUIREMENT,
  HELIX_AGENT_BOUND_ROOM_ENVIRONMENT_PROBE_CAPABILITY,
  HELIX_AGENT_BOUND_ROOM_ENVIRONMENT_PROBE_CAPABILITIES,
  HELIX_AGENT_BOUND_ROOM_ENVIRONMENT_PROBE_DATABASE_SCOPE,
  HELIX_AGENT_BOUND_ROOM_ENVIRONMENT_PROBE_REQUIREMENT,
  HELIX_AGENT_DATABASE_SCOPE_CATALOG,
} from "../../helix-agent-api/database-scope-policy";
import {
  configuredSharedLiveRoomAgentDatabaseScopePolicies,
  withSharedLiveRoomAgentDatabaseScopePolicy,
} from "../agent-database-scope-policy";

describe("Shared Live Room external-agent database scope extension", () => {
  it("adds bound-room evidence without mutating the core catalog", () => {
    const extended = withSharedLiveRoomAgentDatabaseScopePolicy();

    expect(
      HELIX_AGENT_DATABASE_SCOPE_CATALOG.has(
        HELIX_AGENT_BOUND_ROOM_EVIDENCE_DATABASE_SCOPE,
      ),
    ).toBe(false);
    expect(
      extended.get(HELIX_AGENT_BOUND_ROOM_EVIDENCE_DATABASE_SCOPE),
    ).toEqual({
      allowedTools: [HELIX_AGENT_BOUND_ROOM_EVIDENCE_CAPABILITY],
      requiredEvidence: [HELIX_AGENT_BOUND_ROOM_EVIDENCE_REQUIREMENT],
      oauthScope: HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
    });
    expect(
      extended.get(
        HELIX_AGENT_BOUND_ROOM_ENVIRONMENT_PROBE_DATABASE_SCOPE,
      ),
    ).toEqual({
      allowedTools: HELIX_AGENT_BOUND_ROOM_ENVIRONMENT_PROBE_CAPABILITIES,
      requiredEvidence: [
        HELIX_AGENT_BOUND_ROOM_ENVIRONMENT_PROBE_REQUIREMENT,
      ],
      oauthScope: HELIX_SHARED_LIVE_ROOM_READ_SCOPE,
    });
    expect(
      HELIX_AGENT_BOUND_ROOM_ENVIRONMENT_PROBE_CAPABILITIES,
    ).toContain(HELIX_AGENT_BOUND_ROOM_ENVIRONMENT_PROBE_CAPABILITY);
  });

  it("admits the extension only when deployment configuration selects it", () => {
    expect(
      configuredSharedLiveRoomAgentDatabaseScopePolicies(new Set()).size,
    ).toBe(0);
    const configured = configuredSharedLiveRoomAgentDatabaseScopePolicies(
      new Set([
        "repository_evidence",
        HELIX_AGENT_BOUND_ROOM_EVIDENCE_DATABASE_SCOPE,
        HELIX_AGENT_BOUND_ROOM_ENVIRONMENT_PROBE_DATABASE_SCOPE,
        "attacker_defined_scope",
      ]),
    );
    expect(Array.from(configured.keys())).toEqual([
      "repository_evidence",
      HELIX_AGENT_BOUND_ROOM_EVIDENCE_DATABASE_SCOPE,
      HELIX_AGENT_BOUND_ROOM_ENVIRONMENT_PROBE_DATABASE_SCOPE,
    ]);
    expect(configured.has("attacker_defined_scope")).toBe(false);
  });
});
