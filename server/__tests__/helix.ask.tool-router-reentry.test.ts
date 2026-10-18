import { describe, expect, it } from "vitest";
import { helixToolRouter } from "../services/helix-ask/tool-router/helix-tool-router";
import type { HelixAgentStepDecisionV2 } from "@shared/helix-agent-step-observation-packet";

describe("Helix Ask tool router observation re-entry", () => {
  it("turns a model-selected capability into a validated non-terminal runtime call", async () => {
    const surface = helixToolRouter.buildToolSurfacePacket({
      turnId: "turn-search-docs",
      prompt: "Search docs for Alcubierre drive energy conditions.",
      activePanels: ["docs-viewer"],
      focusedPanelId: "docs-viewer",
      explicitAttachmentAvailable: true,
      explicitToolIntent: true,
      maxEntries: 30,
    });
    const decision: HelixAgentStepDecisionV2 = {
      schema: "helix.agent_step_decision.v2",
      turn_id: "turn-search-docs",
      iteration: 0,
      decision_id: "decision-search-docs",
      next_step: "use_capability",
      chosen_capability: "docs-viewer.search_docs",
      runtime_tool_call: {
        call_id: "call-search-docs",
        capability_key: "docs-viewer.search_docs",
        panel_id: "docs-viewer",
        action: "search_docs",
        args: { query: "Alcubierre drive energy conditions" },
      },
      assistant_answer: false,
      raw_content_included: false,
    };

    const call = helixToolRouter.validateRuntimeToolCall(
      helixToolRouter.buildRuntimeToolCallFromDecision(decision, surface),
      surface,
      {
        explicitAttachmentAvailable: true,
        explicitUserInstruction: true,
        confirmationGranted: false,
      },
    );

    expect(call.validation.ok).toBe(true);
    expect(call.runtime_shape).toBe("run_panel_action");
    expect(call.post_tool_model_step_required).toBe(true);
    expect(call.policy.terminal_eligible).toBe(false);
    expect(call.assistant_answer).toBe(false);

    const raw = await helixToolRouter.dispatchRuntimeToolCall(call, {
      surface,
      explicitAttachmentAvailable: true,
      explicitUserInstruction: true,
      confirmationGranted: false,
    });
    const packet = helixToolRouter.toObservationPacket({
      turnId: "turn-search-docs",
      iteration: 0,
      call,
      result: raw,
    });

    expect(packet.schema).toBe("helix.agent_step_observation_packet.v1");
    expect(packet.call_id).toBe("call-search-docs");
    expect(packet.status).toBe("client_pending");
    expect(packet.terminal_eligible).toBe(false);
    expect(packet.assistant_answer).toBe(false);
    expect(packet.post_tool_model_step_required).toBe(true);
    expect(packet.suggested_next_steps).toContain("ask_user");
  });

  it("maps open actions to open_panel and every other selected action to run_panel_action", () => {
    const surface = helixToolRouter.buildToolSurfacePacket({
      turnId: "turn-open-docs",
      prompt: "Open the docs viewer.",
      activePanels: [],
      focusedPanelId: null,
      explicitAttachmentAvailable: false,
      explicitToolIntent: true,
      maxEntries: 10,
    });
    const decision: HelixAgentStepDecisionV2 = {
      schema: "helix.agent_step_decision.v2",
      turn_id: "turn-open-docs",
      iteration: 0,
      decision_id: "decision-open-docs",
      next_step: "use_capability",
      chosen_capability: "docs-viewer.open",
      runtime_tool_call: {
        call_id: "call-open-docs",
        capability_key: "docs-viewer.open",
        panel_id: "docs-viewer",
        action: "open",
        args: {},
      },
      assistant_answer: false,
      raw_content_included: false,
    };

    const call = helixToolRouter.buildRuntimeToolCallFromDecision(decision, surface);

    expect(call.runtime_shape).toBe("open_panel");
    expect(call.panel_id).toBe("docs-viewer");
    expect(call.action).toBe("open");
    expect(call.post_tool_model_step_required).toBe(true);
  });

  it("creates pending state and blocks normal answers for missing sources", () => {
    const surface = helixToolRouter.buildToolSurfacePacket({
      turnId: "turn-dottie-minecraft",
      prompt: "Set up Dottie to watch Minecraft route drift.",
      activePanels: ["situation-room-pipelines"],
      focusedPanelId: "situation-room-pipelines",
      explicitAttachmentAvailable: false,
      explicitToolIntent: true,
      maxEntries: 50,
    });
    const decision: HelixAgentStepDecisionV2 = {
      schema: "helix.agent_step_decision.v2",
      turn_id: "turn-dottie-minecraft",
      iteration: 0,
      decision_id: "decision-create-observer",
      next_step: "use_capability",
      chosen_capability: "situation-room-pipelines.dottie.manifest",
      runtime_tool_call: {
        call_id: "call-create-observer",
        capability_key: "situation-room-pipelines.dottie.manifest",
        panel_id: "situation-room-pipelines",
        action: "dottie.manifest",
        args: { topic: "Minecraft route drift" },
      },
      assistant_answer: false,
      raw_content_included: false,
    };
    const call = helixToolRouter.validateRuntimeToolCall(
      helixToolRouter.buildRuntimeToolCallFromDecision(decision, surface),
      surface,
      {
        explicitAttachmentAvailable: false,
        explicitUserInstruction: true,
        confirmationGranted: false,
      },
    );

    expect(call.validation.ok).toBe(false);
    expect(call.validation.violations).toContain("explicit_attachment_missing");
    const raw = {
      status: "missing_input" as const,
      observation_summary: "Minecraft source is not attached.",
      missing_requirements: [
        {
          code: "minecraft_source_missing",
          message: "Attach the Minecraft source before creating the observer.",
          repair_action: "attach_source",
        },
      ],
    };
    const packet = helixToolRouter.toObservationPacket({
      turnId: "turn-dottie-minecraft",
      iteration: 0,
      call,
      result: raw,
    });

    expect(packet.status).toBe("missing_input");
    expect(packet.terminal_eligible).toBe(false);
    expect(packet.suggested_next_steps).toEqual(expect.arrayContaining(["ask_user", "repair"]));
  });

  it("keeps destructive and voice confirmation actions behind validation", () => {
    const surface = helixToolRouter.buildToolSurfacePacket({
      turnId: "turn-confirmation",
      prompt: "Delete my active note and have Dottie read that out loud.",
      activePanels: ["workstation-notes", "situation-room-pipelines"],
      focusedPanelId: "workstation-notes",
      explicitAttachmentAvailable: true,
      explicitToolIntent: true,
      maxEntries: 140,
    });

    const deleteDecision: HelixAgentStepDecisionV2 = {
      schema: "helix.agent_step_decision.v2",
      turn_id: "turn-confirmation",
      iteration: 0,
      decision_id: "decision-delete-note",
      next_step: "use_capability",
      chosen_capability: "workstation-notes.delete_note",
      runtime_tool_call: {
        call_id: "call-delete-note",
        capability_key: "workstation-notes.delete_note",
        panel_id: "workstation-notes",
        action: "delete_note",
        args: {},
      },
      assistant_answer: false,
      raw_content_included: false,
    };
    const deleteCall = helixToolRouter.validateRuntimeToolCall(
      helixToolRouter.buildRuntimeToolCallFromDecision(deleteDecision, surface),
      surface,
      {
        explicitAttachmentAvailable: true,
        explicitUserInstruction: true,
        confirmationGranted: false,
      },
    );

    expect(deleteCall.policy.mutating).toBe(true);
    expect(deleteCall.validation.ok).toBe(false);
    expect(deleteCall.validation.violations).toContain("confirmation_required");

    const voiceDecision: HelixAgentStepDecisionV2 = {
      schema: "helix.agent_step_decision.v2",
      turn_id: "turn-confirmation",
      iteration: 0,
      decision_id: "decision-speak",
      next_step: "use_capability",
      chosen_capability: "situation-room-pipelines.voice_delivery.confirm_speak",
      runtime_tool_call: {
        call_id: "call-speak",
        capability_key: "situation-room-pipelines.voice_delivery.confirm_speak",
        panel_id: "situation-room-pipelines",
        action: "voice_delivery.confirm_speak",
        args: { thread_id: "thread-1" },
      },
      assistant_answer: false,
      raw_content_included: false,
    };
    const voiceCall = helixToolRouter.validateRuntimeToolCall(
      helixToolRouter.buildRuntimeToolCallFromDecision(voiceDecision, surface),
      surface,
      {
        explicitAttachmentAvailable: true,
        explicitUserInstruction: false,
        confirmationGranted: false,
      },
    );

    expect(voiceCall.validation.ok).toBe(false);
    expect(voiceCall.validation.violations).toContain("manual_only_requires_explicit_user_instruction");
  });
});
