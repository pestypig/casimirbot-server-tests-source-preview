import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { HelixSituationSourceCapability } from "@shared/helix-situation-source-capability";
import { buildLiveCardLineStates } from "../services/situation-room/live-card-line-state-builder";
import { buildLiveEnvironmentFidelity } from "../services/situation-room/live-environment-fidelity-builder";
import {
  buildSituationSourceCapabilities,
  recordSituationSourceHeartbeat,
  resetSituationSourceCapabilitiesForTest,
} from "../services/situation-room/situation-source-capability-store";
import {
  ingestWorkstationLiveSourceEvent,
  resetWorkstationLiveSources,
} from "../services/situation-room/workstation-live-source-ingest";
import {
  resetVisualSnapshotStoreForTest,
  startVisualSnapshotSource,
} from "../services/situation-room/visual-snapshot-store";
import { synthesizePresentState } from "../services/situation-room/present-state-synthesizer";

const threadId = "thread:fidelity";
const now = "2026-05-15T05:00:00.000Z";

const createApp = async (): Promise<express.Express> => {
  const { planRouter } = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", planRouter);
  return app;
};

describe("live environment source fidelity", () => {
  beforeEach(() => {
    resetSituationSourceCapabilitiesForTest();
    resetVisualSnapshotStoreForTest();
    resetWorkstationLiveSources();
  });

  it("starts fidelity with Minecraft world events only and marks visual/transcript as missing", () => {
    ingestWorkstationLiveSourceEvent({
      source_id: "source:minecraft-server",
      kind: "minecraft_world_events",
      event_type: "hostile_nearby",
      thread_id: threadId,
      ts: now,
      payload: { actor: "DatDamPig" },
    });

    const capabilities = buildSituationSourceCapabilities({ threadId, now });
    const fidelity = buildLiveEnvironmentFidelity({ threadId, capabilities, now });

    expect(fidelity.assistant_answer).toBe(false);
    expect(fidelity.raw_content_included).toBe(false);
    expect(fidelity.active_modalities).toContain("world_event");
    expect(fidelity.missing_modalities).toEqual(expect.arrayContaining(["visual_frame", "audio_transcript"]));
    expect(fidelity.next_actions).toEqual(expect.arrayContaining(["grant_visual_capture_permission"]));
  });

  it("starts fidelity with a visual source only and does not require world events to exist", () => {
    startVisualSnapshotSource({
      thread_id: threadId,
      source_id: "source:visual-window",
      source_surface: "minecraft_client_window",
      status: "active",
    });

    const fidelity = buildLiveEnvironmentFidelity({
      threadId,
      capabilities: buildSituationSourceCapabilities({ threadId, now }),
      now,
    });

    expect(fidelity.active_modalities).toContain("visual_frame");
    expect(fidelity.missing_modalities).toContain("world_event");
    expect(fidelity.fidelity_score).toBeGreaterThan(0);
  });

  it("uses room-neutral visual sources for room-scoped live environments", () => {
    startVisualSnapshotSource({
      thread_id: threadId,
      source_id: "source:visual-room-neutral",
      room_id: null,
      source_surface: "minecraft_client_window",
      status: "active",
    });

    const capabilities = buildSituationSourceCapabilities({
      threadId,
      roomId: "room:minecraft-minehut",
      now,
    });
    const fidelity = buildLiveEnvironmentFidelity({
      threadId,
      roomId: "room:minecraft-minehut",
      capabilities,
      now,
    });

    expect(capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_id: "source:visual-room-neutral",
        modality: "visual_frame",
        status: "active",
      }),
    ]));
    expect(capabilities).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        modality: "visual_frame",
        status: "configured_missing",
      }),
    ]));
    expect(fidelity.active_modalities).toContain("visual_frame");
    expect(fidelity.missing_modalities).not.toContain("visual_frame");
  });

  it("tracks transcript sources independently from visual sources", () => {
    ingestWorkstationLiveSourceEvent({
      source_id: "source:tab-transcript",
      kind: "browser_audio_transcript",
      event_type: "transcript_summary",
      thread_id: threadId,
      ts: now,
      payload: { text: "I am decorating the farm." },
    });

    const fidelity = buildLiveEnvironmentFidelity({
      threadId,
      capabilities: buildSituationSourceCapabilities({ threadId, now }),
      now,
    });

    expect(fidelity.active_modalities).toContain("audio_transcript");
    expect(fidelity.missing_modalities).toEqual(expect.arrayContaining(["world_event", "visual_frame"]));
  });

  it("adds source coverage to live card line state", () => {
    ingestWorkstationLiveSourceEvent({
      source_id: "source:minecraft-server",
      kind: "minecraft_world_events",
      event_type: "hostile_nearby",
      thread_id: threadId,
      ts: now,
      payload: {},
    });
    const capabilities = buildSituationSourceCapabilities({ threadId, now });
    const states = buildLiveCardLineStates({
      lines: [{
        key: "risk",
        label: "Risk",
        value: "nearby hostile context, no damage event in current window.",
        confidence: 0.65,
        evidence_refs: ["event:hostile"],
        updated_at: now,
      }],
      sourceCapabilities: capabilities,
      now,
    });

    expect(states[0].source_coverage.world_event).toBe("supported");
    expect(states[0].source_coverage.visual_frame).toBe("not_applicable");
    expect(states[0].assistant_answer).toBe(false);
  });

  it("does not copy setup prompts into missing evidence", () => {
    const setupPrompt = "I have visual capture active. Set up a Minecraft Cortana live environment using the active visual source. I do not have the Minecraft plugin source attached yet, so start visual-only, show missing source fidelity, capture and analyze the first frame, derive the live card from visual evidence, and prepare line checks for Minecraft world events if they become available.";
    const states = buildLiveCardLineStates({
      lines: [{
        key: "missing_evidence",
        label: "Missing evidence",
        value: setupPrompt,
        confidence: null,
        evidence_refs: ["live_answer_environment:setup"],
        updated_at: now,
      }],
      sourceCapabilities: buildSituationSourceCapabilities({ threadId, now }),
      now,
    });

    expect(states[0].missing_evidence.join(" ")).not.toContain("I have visual capture active");
    expect(states[0].missing_evidence.join(" ")).not.toContain("Set up a Minecraft Cortana");
  });

  it("does not emit current hostile risk when world events are missing", () => {
    const states = buildLiveCardLineStates({
      lines: [{
        key: "risk",
        label: "Risk",
        value: "Nearby hostile context, no damage event in the current compact window.",
        confidence: 0.7,
        evidence_refs: ["live_answer_environment:setup"],
        updated_at: now,
      }],
      sourceCapabilities: buildSituationSourceCapabilities({ threadId, now }),
      now,
    });
    const synthesis = synthesizePresentState({
      threadId,
      lineStates: states,
      fidelityProfile: {
        schema: "helix.live_environment_fidelity.v1",
        thread_id: threadId,
        active_modalities: ["visual_frame"],
        missing_modalities: ["world_event", "audio_transcript"],
        stale_modalities: [],
        fidelity_score: 0.4,
        source_contribution_map: { visual_frame: ["visual_scene"] },
        per_line_coverage: {},
        next_actions: ["attach_world_event_source"],
        capabilities: [],
        raw_content_included: false,
        assistant_answer: false,
        context_policy: "compact_context_pack_only",
        created_at: now,
      },
      now,
    });

    const risk = synthesis.lines.find((line) => line.key === "risk");
    expect(risk?.value).toMatch(/not confirmed/i);
    expect(risk?.value).not.toMatch(/nearby hostile context/i);
  });

  it("seeds present state from analyzed visual evidence before setup defaults", () => {
    const states = buildLiveCardLineStates({
      lines: [{
        key: "place",
        label: "Place",
        value: "The Minecraft screen shows an inventory panel with item stacks and a game HUD.",
        confidence: 0.68,
        evidence_refs: ["visual_evidence:inventory"],
        updated_at: now,
      }, {
        key: "activity",
        label: "Activity",
        value: "Monitoring current Minecraft activity.",
        confidence: 0.42,
        evidence_refs: ["live_answer_environment:setup"],
        updated_at: now,
      }],
      sourceCapabilities: [{
        schema: "helix.situation_source_capability.v1",
        source_id: "source:visual-inventory",
        thread_id: threadId,
        modality: "visual_frame",
        status: "active",
        contribution: "visual_scene",
        fidelity_score: 1,
        last_event_ts: now,
        raw_content_included: false,
        assistant_answer: false,
      }],
      now,
    });
    const synthesis = synthesizePresentState({
      threadId,
      lineStates: states,
      fidelityProfile: {
        schema: "helix.live_environment_fidelity.v1",
        thread_id: threadId,
        active_modalities: ["visual_frame"],
        missing_modalities: ["world_event", "audio_transcript"],
        stale_modalities: [],
        fidelity_score: 0.5,
        source_contribution_map: { visual_frame: ["visual_scene"] },
        per_line_coverage: {},
        next_actions: ["attach_world_event_source"],
        capabilities: [],
        raw_content_included: false,
        assistant_answer: false,
        context_policy: "compact_context_pack_only",
        created_at: now,
      },
      now,
    });

    expect(synthesis.lines[0].value).toContain("inventory panel");
    expect(synthesis.lines[0].evidence_refs).toContain("visual_evidence:inventory");
  });

  it("does not synthesize farm/base language for generic visual-only sources", () => {
    const states = buildLiveCardLineStates({
      lines: [{
        key: "scene",
        label: "Scene",
        value: "A browser tab with a dashboard is visible.",
        confidence: 0.7,
        evidence_refs: ["visual_evidence:dashboard"],
        updated_at: now,
      }],
      sourceCapabilities: [
        {
          schema: "helix.situation_source_capability.v1",
          source_id: "source:visual-dashboard",
          thread_id: threadId,
          modality: "visual_frame",
          status: "active",
          contribution: "visual_scene",
          fidelity_score: 0.8,
          last_event_ts: now,
          raw_content_included: false,
          assistant_answer: false,
        },
      ],
      now,
    });
    const synthesis = synthesizePresentState({
      threadId,
      lineStates: states,
      interpretedEvents: [{
        schema: "helix.interpreted_event.v1",
        event_id: "visual:event:dashboard",
        thread_id: threadId,
        kind: "visual_observation",
        title: "Visual frame analyzed",
        summary: "A browser tab with a dashboard and controls is visible.",
        evidence_refs: ["visual_evidence:dashboard"],
        created_at: now,
        model_invoked: true,
        deterministic: false,
        assistant_answer: false,
        raw_logs_included: false,
        context_policy: "compact_context_pack_only",
      }],
      fidelityProfile: {
        schema: "helix.live_environment_fidelity.v1",
        thread_id: threadId,
        active_modalities: ["visual_frame"],
        missing_modalities: ["world_event", "audio_transcript"],
        stale_modalities: [],
        fidelity_score: 0.5,
        source_contribution_map: { visual_frame: ["visual_scene"] },
        per_line_coverage: {},
        next_actions: ["attach_world_event_source"],
        capabilities: [],
        raw_content_included: false,
        assistant_answer: false,
        context_policy: "compact_context_pack_only",
        created_at: now,
      },
      now,
    });
    expect(JSON.stringify(synthesis)).not.toContain("Farm/base");
    expect(synthesis.lines[0]).toMatchObject({ key: "scene", label: "Scene" });
  });

  it("marks stale source heartbeat as stale in the fidelity profile", () => {
    recordSituationSourceHeartbeat({
      source_id: "source:voice",
      thread_id: threadId,
      modality: "audio_transcript",
      status: "active",
      ts: "2026-05-15T04:30:00.000Z",
    });

    const fidelity = buildLiveEnvironmentFidelity({
      threadId,
      capabilities: buildSituationSourceCapabilities({ threadId, now }),
      now,
    });

    expect(fidelity.stale_modalities).toContain("audio_transcript");
    expect(fidelity.next_actions).toContain("send_source_heartbeat");
  });

  it("exposes source capability, fidelity, and permission-granted routes", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/visual-source/start")
      .send({
        thread_id: threadId,
        source_id: "source:visual-route",
        source_surface: "minecraft_client_window",
        status: "permission_required",
      })
      .expect(200);

    const before = await request(app)
      .get(`/api/agi/situation/source-capabilities?thread_id=${encodeURIComponent(threadId)}`)
      .expect(200);
    expect((before.body.capabilities as HelixSituationSourceCapability[])
      .some((entry) => entry.modality === "visual_frame" && entry.status === "permission_required")).toBe(true);

    await request(app)
      .post("/api/agi/situation/visual-source/permission-granted")
      .send({ source_id: "source:visual-route", client_stream_confirmed: true })
      .expect(200);

    const after = await request(app)
      .get(`/api/agi/situation/live-environment/fidelity?thread_id=${encodeURIComponent(threadId)}`)
      .expect(200);
    expect(after.body.fidelity).toMatchObject({
      assistant_answer: false,
      raw_content_included: false,
      context_policy: "compact_context_pack_only",
    });
    expect(after.body.fidelity.active_modalities).toContain("visual_frame");

    const latest = await request(app)
      .get(`/api/agi/situation/visual-frame/latest?thread_id=${encodeURIComponent(threadId)}`)
      .expect(200);
    expect(latest.body.visual_evidence_health).toMatchObject({
      schema: "helix.visual_evidence_health.v1",
      status: "waiting_for_first_frame",
      assistant_answer: false,
      raw_image_included: false,
    });

    const provider = await request(app)
      .get("/api/agi/situation/visual-provider/health")
      .expect(200);
    expect(provider.body).toMatchObject({
      schema: "helix.visual_provider_health.v1",
      assistant_answer: false,
      raw_image_included: false,
    });
  }, 15000);

  it("does not mark visual capture active until the client confirms a stream", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/agi/situation/visual-source/start")
      .send({
        thread_id: threadId,
        source_id: "source:visual-needs-stream",
        source_surface: "minecraft_client_window",
        status: "permission_required",
      })
      .expect(200);

    const denied = await request(app)
      .post("/api/agi/situation/visual-source/permission-granted")
      .send({ source_id: "source:visual-needs-stream" })
      .expect(409);

    expect(denied.body).toMatchObject({
      ok: false,
      error: "client_stream_not_confirmed",
      activation_receipt: {
        schema: "helix.source_activation_receipt.v1",
        ok: false,
        requested_status: "active",
        observed_status: "permission_required",
        assistant_answer: false,
        raw_content_included: false,
      },
    });
  }, 15000);

  it("records audio transcript chunks as source observations without raw transcript promotion", async () => {
    const app = await createApp();
    const permission = await request(app)
      .post("/api/agi/situation/audio-source/permission-granted")
      .send({
        thread_id: threadId,
        source_id: "source:tab-audio",
      })
      .expect(200);
    expect(permission.body.activation_receipt).toMatchObject({
      schema: "helix.source_activation_receipt.v1",
      modality: "audio_transcript",
      observed_status: "active",
      assistant_answer: false,
    });

    const chunk = await request(app)
      .post("/api/agi/situation/audio-source/transcript-chunk")
      .send({
        thread_id: threadId,
        source_id: "source:tab-audio",
        environment_id: "env:audio-test",
        transcript: "Helix, I am decorating the farm boundary.",
        transcript_is_final: true,
        direct_address_classification: "direct_address",
        duration_ms: 10_000,
      })
      .expect(200);

    expect(chunk.body).toMatchObject({
      ok: true,
      assistant_answer: false,
      raw_transcript_included: false,
      source_event: {
        item_type: "toolObservation",
        source_family: "audio_transcript",
        assistant_answer: false,
        raw_transcript_included: false,
      },
    });
    expect(chunk.body.live_source_event.kind).toBe("browser_audio_transcript");
    expect(chunk.body.live_source_chunk).toMatchObject({
      source_id: "source:tab-audio",
      thread_id: threadId,
      environment_id: "env:audio-test",
      modality: "audio_transcript",
      duration_ms: 10_000,
    });
  }, 30000);
});
