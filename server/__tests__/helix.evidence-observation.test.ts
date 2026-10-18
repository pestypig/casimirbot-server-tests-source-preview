import { describe, expect, it } from "vitest";

import {
  assertHelixEvidenceObservationRole,
  buildHelixEvidenceObservation,
  inferHelixEvidenceSourceKindFromRef,
  mergeHelixEvidenceObservations,
} from "../../shared/helix-evidence-observation";
import { formatRepoSearchEvidence } from "../services/helix-ask/repo-search";

describe("helix evidence observations", () => {
  it("normalizes refs and keeps deterministic evidence role explicit", () => {
    const observation = buildHelixEvidenceObservation({
      source_kind: "repo_code",
      source_id: null,
      observed_at: new Date("2026-05-18T12:00:00.000Z"),
      provenance: "retrieved",
      confidence: 3,
      refs: ["server\\modules\\starsim\\contract.ts:12", "server/modules/starsim/contract.ts:12"],
      content_role: "evidence_not_assistant_answer",
      consent_state: "not_required",
    });

    expect(observation).toMatchObject({
      source_kind: "repo_code",
      lane: "repo_search",
      source_id: "server/modules/starsim/contract.ts:12",
      observed_at: "2026-05-18T12:00:00.000Z",
      provenance: "retrieved",
      confidence: 1,
      refs: ["server/modules/starsim/contract.ts:12"],
      content_role: "evidence_not_assistant_answer",
      consent_state: "not_required",
    });
    expect(() => assertHelixEvidenceObservationRole(observation)).not.toThrow();
  });

  it("builds stable IDs and dedupes duplicate observations", () => {
    const first = buildHelixEvidenceObservation({
      lane: "git_tracked",
      source_kind: "repo_code",
      source_id: "server/modules/starsim/contract.ts:42",
      observed_at: "2026-05-18T12:00:00.000Z",
      provenance: "retrieved",
      confidence: 0.85,
      refs: ["server/modules/starsim/contract.ts:42"],
      content_role: "evidence_not_assistant_answer",
      filePath: "server/modules/starsim/contract.ts",
      lineStart: 42,
      lineEnd: 42,
      snippet: "requestedLanes: StarSimLane[]",
      term: "requestedLanes",
    });
    const second = buildHelixEvidenceObservation({
      lane: "git_tracked",
      source_kind: "repo_code",
      source_id: "server/modules/starsim/contract.ts:42",
      observed_at: "2026-05-18T12:05:00.000Z",
      provenance: "retrieved",
      confidence: 0.7,
      refs: ["server/modules/starsim/contract.ts:42"],
      content_role: "evidence_not_assistant_answer",
      filePath: "server/modules/starsim/contract.ts",
      lineStart: 42,
      lineEnd: 42,
      snippet: "requestedLanes: StarSimLane[]",
      term: "requestedLanes",
    });

    expect(first.id).toBe(second.id);
    expect(mergeHelixEvidenceObservations([first], [second])).toEqual([first]);
  });

  it("classifies repo paths by source kind", () => {
    expect(inferHelixEvidenceSourceKindFromRef("server/modules/starsim/contract.ts")).toBe(
      "repo_code",
    );
    expect(inferHelixEvidenceSourceKindFromRef("docs/starsim/solar-baseline.md")).toBe(
      "repo_doc",
    );
    expect(inferHelixEvidenceSourceKindFromRef("artifacts/helix/report.json")).toBe("artifact");
  });

  it("adds evidence observations to repo search formatting", () => {
    const formatted = formatRepoSearchEvidence({
      truncated: false,
      hits: [
        {
          filePath: "server/modules/starsim/contract.ts",
          line: 42,
          text: "requestedLanes: StarSimLane[]",
          term: "requestedLanes",
        },
        {
          filePath: "docs/starsim/solar-baseline.md",
          line: 7,
          text: "StarSim baseline evidence.",
          term: "StarSim",
        },
      ],
    });

    expect(formatted.evidenceText).toContain("server/modules/starsim/contract.ts:42");
    expect(formatted.filePaths).toEqual([
      "server/modules/starsim/contract.ts",
      "docs/starsim/solar-baseline.md",
    ]);
    expect(formatted.observations).toHaveLength(2);
    expect(formatted.observations[0]).toMatchObject({
      lane: "repo_search",
      source_kind: "repo_code",
      source_id: "server/modules/starsim/contract.ts:42",
      refs: ["server/modules/starsim/contract.ts:42"],
      provenance: "retrieved",
      content_role: "evidence_not_assistant_answer",
      filePath: "server/modules/starsim/contract.ts",
      lineStart: 42,
      lineEnd: 42,
      snippet: "requestedLanes: StarSimLane[]",
      term: "requestedLanes",
    });
    expect(formatted.observations[0]?.id).toMatch(/^obs_[a-f0-9]{8}$/);
    expect(formatted.observations[1]?.source_kind).toBe("repo_doc");
  });
});
