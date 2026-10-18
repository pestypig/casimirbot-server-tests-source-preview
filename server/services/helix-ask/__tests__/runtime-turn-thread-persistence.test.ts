import { beforeEach, describe, expect, it } from "vitest";
import { __resetHelixThreadLedgerStore } from "../../helix-thread/ledger";
import { buildHelixConversationMemoryPacket } from "../conversation-memory-selector";
import {
  extractRuntimeDocumentEvidencePaths,
  extractRuntimeSelectedEnvironmentProbeLocators,
  extractRuntimeSelectedObservationRefs,
  persistHelixAskRuntimeTurnThreadCompletion,
} from "../runtime-turn-thread-persistence";

describe("runtime turn thread persistence", () => {
  beforeEach(() => {
    __resetHelixThreadLedgerStore();
  });

  it("makes direct Ask runtime document citations available as nonterminal fresh-read locators", () => {
    const threadId = "thread:runtime-persistence";
    persistHelixAskRuntimeTurnThreadCompletion({
      threadId,
      turnId: "ask:turn-1",
      sessionId: threadId,
      promptText: "Find the named study.",
      terminalText:
        "The correct study is a bounded theoretical proposal.",
      finalStatus: "final_answer",
      documentEvidencePaths: extractRuntimeDocumentEvidencePaths({
        workstation_gateway_call_results: [
          {
            capability_id: "docs.search",
            observation: {
              document_candidates: [
                {
                  path: "docs/research/casimir-dp-quantum-foam-study.md",
                },
              ],
              paths: [
                "docs/research/casimir-dp-quantum-foam-study.md",
              ],
            },
          },
        ],
      }),
    });

    const packet = buildHelixConversationMemoryPacket({
      threadId,
      currentTurnId: "ask:turn-2",
      sessionId: threadId,
      promptText: "Stay with that same document and inspect its equations.",
      allowsPriorArtifacts: true,
    });

    expect(packet.reusable_evidence_refs).toContain(
      "docs/research/casimir-dp-quantum-foam-study.md",
    );
    expect(packet.allowed_use).toBe("reuse_prior_evidence_refs");
    expect(packet.terminal_eligible).toBe(false);
  });

  it("prefers document identities from Docs observations over model wording", () => {
    expect(
      extractRuntimeDocumentEvidencePaths({
        workstation_gateway_call_results: [
          {
            capability_id: "docs.search",
            observation: {
              document_candidates: [
                { path: "docs/research/canonical-study.md" },
              ],
              paths: ["docs"],
            },
          },
          {
            capability_id: "docs.search",
            observation: {
              document_candidates: [
                { path: "docs/research/canonical-study.md" },
              ],
              paths: ["docs/research/canonical-study.md"],
            },
          },
          {
            capability_id: "workspace.status",
            observation: { path: "docs/unrelated.md" },
          },
        ],
      }),
    ).toEqual(["docs/research/canonical-study.md"]);
  });

  it("persists only terminal-selected observations proven by current-turn re-entry", () => {
    const threadId = "thread:runtime-selected-observation";
    const verifiedRef =
      "ask:turn-1:workstation_gateway:com.casimirbot.minecraft.reachability.check:verified";
    const forgedPresentationRef =
      "ask:turn-1:workstation_gateway:com.casimirbot.minecraft.inventory.check:forged";
    const unselectedGateRef =
      "ask:turn-1:workstation_gateway:com.casimirbot.minecraft.hazards.scan:unselected";
    const payload = {
      terminal_presentation: {
        schema: "helix.terminal_presentation.v1",
        selected_observation_refs: [verifiedRef, forgedPresentationRef],
      },
      terminal_answer_authority: {
        server_authoritative: true,
      },
      ask_turn_solver_trace: {
        evidence_reentry_gate: {
          schema: "helix.evidence_reentry_gate.v1",
          completed: true,
          violation_codes: [],
          selected_evidence_refs: [verifiedRef, unselectedGateRef],
        },
      },
      current_turn_artifact_ledger: [
        { artifact_id: verifiedRef },
        { artifact_id: forgedPresentationRef },
        { artifact_id: unselectedGateRef },
      ],
      workstation_gateway_call_results: [
        {
          capability_id:
            "com.casimirbot.minecraft.reachability.check",
          artifact_refs: [verifiedRef],
          observation: {
            schema: "helix.environment_connector.probe_observation.v1",
            probe_request_ref: "environment_probe_request:verified",
            capability_id:
              "com.casimirbot.minecraft.reachability.check",
            outcome: "succeeded",
            provenance_valid: true,
            eligible_for_current_turn_reentry: true,
            assistant_answer: false,
            terminal_eligible: false,
            raw_content_included: false,
          },
          observation_packet: {
            produced_artifact_refs: [verifiedRef],
          },
        },
      ],
    };

    const selectedObservationRefs =
      extractRuntimeSelectedObservationRefs(payload);
    expect(selectedObservationRefs).toEqual([verifiedRef]);
    const selectedEnvironmentProbeLocators =
      extractRuntimeSelectedEnvironmentProbeLocators(payload);
    expect(selectedEnvironmentProbeLocators).toEqual([
      {
        artifactRef: verifiedRef,
        probeRequestRef: "environment_probe_request:verified",
        capabilityId:
          "com.casimirbot.minecraft.reachability.check",
      },
    ]);

    persistHelixAskRuntimeTurnThreadCompletion({
      threadId,
      turnId: "ask:turn-1",
      sessionId: threadId,
      promptText: "Check Minecraft geometry now.",
      terminalText:
        "The straight-line geometry is clear, but path viability is unproven.",
      finalStatus: "final_answer",
      selectedObservationRefs,
      selectedEnvironmentProbeLocators,
    });

    const packet = buildHelixConversationMemoryPacket({
      threadId,
      currentTurnId: "ask:turn-2",
      sessionId: threadId,
      promptText:
        "Given the current Minecraft observations you just gathered, what should I fix first?",
      allowsPriorArtifacts: true,
    });

    expect(packet.reusable_evidence_refs).toContain(verifiedRef);
    expect(packet.resolved_references[0]).toMatchObject({
      refers_to_kind: "prior_evidence",
      refers_to_artifact_ref: verifiedRef,
    });
    expect(packet.reusable_evidence_refs).not.toContain(
      forgedPresentationRef,
    );
    expect(packet.reusable_evidence_refs).not.toContain(unselectedGateRef);
  });

  it("rejects observation persistence without terminal and re-entry authority", () => {
    const ref = "ask:turn-1:observation:unverified";
    expect(
      extractRuntimeSelectedObservationRefs({
        terminal_presentation: {
          schema: "helix.terminal_presentation.v1",
          selected_observation_refs: [ref],
        },
        current_turn_artifact_ledger: [{ artifact_id: ref }],
      }),
    ).toEqual([]);
  });

  it("keeps the newest selected observations when prior evidence exceeds the bounded memory budget", () => {
    const threadId = "thread:runtime-evidence-recency";
    for (const turnNumber of [1, 2, 3]) {
      const turnId = `ask:turn-${turnNumber}`;
      persistHelixAskRuntimeTurnThreadCompletion({
        threadId,
        turnId,
        sessionId: threadId,
        promptText: `Inspect environment state ${turnNumber}.`,
        terminalText: `Environment state ${turnNumber} was inspected.`,
        finalStatus: "final_answer",
        selectedObservationRefs: [
          `${turnId}:observation:first`,
          `${turnId}:observation:second`,
        ],
      });
    }

    const packet = buildHelixConversationMemoryPacket({
      threadId,
      currentTurnId: "ask:turn-4",
      sessionId: threadId,
      promptText:
        "Given the current Minecraft observations you just gathered, what should I fix first?",
      allowsPriorArtifacts: true,
      maxRefs: 2,
    });

    expect(packet.reusable_evidence_refs).toEqual(
      expect.arrayContaining([
        "ask:turn-3:observation:first",
        "ask:turn-3:observation:second",
      ]),
    );
    expect(packet.reusable_evidence_refs).not.toContain(
      "ask:turn-1:observation:first",
    );
    expect(packet.resolved_references[0]).toMatchObject({
      refers_to_turn_id: "ask:turn-3",
      refers_to_kind: "prior_evidence",
    });
  });

  it("is idempotent for a completed turn", () => {
    const input = {
      threadId: "thread:runtime-idempotent",
      turnId: "ask:turn-1",
      sessionId: "thread:runtime-idempotent",
      promptText: "Find a document.",
      terminalText: "Found docs/example.md.",
      finalStatus: "final_answer" as const,
    };
    persistHelixAskRuntimeTurnThreadCompletion(input);
    persistHelixAskRuntimeTurnThreadCompletion(input);

    const packet = buildHelixConversationMemoryPacket({
      threadId: input.threadId,
      currentTurnId: "ask:turn-2",
      sessionId: input.sessionId,
      promptText: "Use that same document.",
      allowsPriorArtifacts: true,
    });
    expect(packet.recent_user_goals).toEqual(["Find a document."]);
    expect(packet.recent_assistant_answers).toEqual([
      "Found docs/example.md.",
    ]);
  });
});
