import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readStagePlayMailWakeRouteMetadata,
  readStagePlayMailWakeRouteMetadataFromPayload,
} from "../services/helix-ask/live-source/stage-play-mail-wake-route-metadata";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/live-source/stage-play-mail-wake-route-metadata.ts");

describe("stage play mail wake route metadata extraction boundary", () => {
  const routeSource = readFileSync(routePath, "utf8");
  const serviceSource = readFileSync(servicePath, "utf8");

  it("moves metadata schema and readers out of agi.plan.ts", () => {
    expect(routeSource).toContain("../services/helix-ask/live-source/stage-play-mail-wake-route-metadata");
    expect(routeSource).not.toMatch(/const\s+StagePlayMailWakeRouteMetadataSchema\s*=\s*z/);
    expect(routeSource).not.toMatch(/const\s+synthesizeStagePlayMailWakeRouteMetadata\s*=/);
    expect(routeSource).not.toMatch(/const\s+readStagePlayMailWakeRouteMetadata\s*=/);
    expect(routeSource).not.toMatch(/const\s+readStagePlayMailWakeRouteMetadataFromPayload\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+StagePlayMailWakeRouteMetadataSchema\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readStagePlayMailWakeRouteMetadata\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readStagePlayMailWakeRouteMetadataFromPayload\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
  });

  it("preserves synthesis from source-target intent metadata", () => {
    const metadata = readStagePlayMailWakeRouteMetadata({
      source_target_intent: {
        source: "stage_play_mail_wake_route_metadata",
        stage_play_live_source_mail_wake_request_id: "stage_play_live_source_mail_wake:test",
        recommended_next: "request_voice_callout",
        required_phase: "decision",
        stage_play_mail_wake_route_metadata: {
          allowed_capabilities: ["live_env.record_live_source_mail_decision"],
          evidence_refs: ["stage_play_processed_mail_packet:test"],
        },
      },
    });

    expect(metadata).toMatchObject({
      invocationKind: "stage_play_mail_wake",
      wakeRequestId: "stage_play_live_source_mail_wake:test",
      mailboxThreadId: "helix-ask:desktop",
      sourceTarget: "live_source_mailbox",
      requiredCanonicalGoal: "processed_mail_voice_decision",
      requiredPhase: "decision",
      allowedCapabilities: ["live_env.record_live_source_mail_decision"],
      evidenceRefs: ["stage_play_processed_mail_packet:test"],
    });
  });

  it("preserves payload fallback from canonical goal frame wake signals", () => {
    const metadata = readStagePlayMailWakeRouteMetadataFromPayload({
      thread_id: "thread-1",
      source_target_intent: {
        source: "stage_play_mail_wake_route_metadata",
      },
      canonical_goal_frame: {
        concept_tokens: [
          "stage_play_mail_wake",
          "stage_play_live_source_mail_wake:abc",
          "processed_mail_checkpoint",
          "stage_play_processed_mail_packet:abc",
        ],
        classifier_reasons: ["stage_play_mail_wake_route_metadata", "live_source_phase:checkpoint"],
      },
    });

    expect(metadata).toMatchObject({
      invocationKind: "stage_play_mail_wake",
      wakeRequestId: "stage_play_live_source_mail_wake:abc",
      mailboxThreadId: "thread-1",
      sourceTarget: "live_source_mailbox",
      requiredCanonicalGoal: "processed_mail_checkpoint",
      requiredPhase: "checkpoint",
      evidenceRefs: ["stage_play_processed_mail_packet:abc"],
    });
  });
});
