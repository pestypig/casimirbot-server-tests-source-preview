import { describe, expect, it } from "vitest";

import { buildWorkstationGatewayObservationPacket } from "../observation-packet";

describe("workstation gateway observation packet identity", () => {
  const build = (query: string) => buildWorkstationGatewayObservationPacket({
    turnId: "turn-scholarly-recovery",
    iteration: 1,
    capabilityId: "scholarly-research.lookup_papers",
    panelId: "scholarly-research",
    action: "lookup_papers",
    status: "succeeded",
    summary: `Lookup completed for ${query}`,
    observation: {
      schema: "helix.scholarly_research_observation.v1",
      query,
      papers: [],
    },
  });

  it("keeps repeated same-capability calls distinct when their observations differ", () => {
    const first = build("magnetars");
    const recovery = build("primary observational magnetar paper");

    expect(first.call_id).not.toBe(recovery.call_id);
    expect(first.decision_id).not.toBe(recovery.decision_id);
    expect(first.produced_artifact_refs).not.toEqual(recovery.produced_artifact_refs);
  });

  it("keeps packet identity stable for the same observed call", () => {
    expect(build("magnetars")).toMatchObject({
      call_id: build("magnetars").call_id,
      decision_id: build("magnetars").decision_id,
      produced_artifact_refs: build("magnetars").produced_artifact_refs,
    });
  });
});
