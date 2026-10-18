import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectMailLoopProgressRefs,
  createMailLoopProgressStopReasonResolver,
  createMailLoopToolProgressReceiptAppender,
  createMailLoopToolProgressReceiptBuilder,
  isMailLoopProgressRef,
  mailLoopProgressKindForRefs,
} from "../services/helix-ask/live-source/mail-progress-refs";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/live-source/mail-progress-refs.ts");

describe("Helix Ask live-source mail progress refs extraction boundary", () => {
  it("keeps mail-loop progress ref collection out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/live-source/mail-progress-refs");
    expect(routeSource).not.toContain("STAGE_PLAY_MAIL_LOOP_PROGRESS_REF_RE");
    expect(routeSource).not.toMatch(/const\s+isMailLoopProgressRef\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+collectMailLoopProgressRefs\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+mailLoopProgressKindForRefs\s*=\s*\(/);
    expect(routeSource).not.toMatch(/const\s+buildMailLoopToolProgressReceipt\s*=\s*\(args:\s*\{/);
    expect(routeSource).toMatch(/const\s+buildMailLoopToolProgressReceipt\s*=\s*createMailLoopToolProgressReceiptBuilder\(/);
    expect(routeSource).toMatch(/createMailLoopToolProgressReceiptAppender\(\{/);
    expect(routeSource).toMatch(/createMailLoopProgressStopReasonResolver\(\{/);
    expect(serviceSource).toMatch(/export\s+const\s+isMailLoopProgressRef\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+collectMailLoopProgressRefs\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+mailLoopProgressKindForRefs\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createMailLoopToolProgressReceiptBuilder\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createMailLoopToolProgressReceiptAppender\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+createMailLoopProgressStopReasonResolver\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves accepted progress ref prefixes", () => {
    expect(isMailLoopProgressRef("stage_play_processed_mail_packet:abc")).toBe(true);
    expect(isMailLoopProgressRef("stage_play_live_source_mail_decision:abc")).toBe(true);
    expect(isMailLoopProgressRef("stage_play_live_source_narrative_state:abc")).toBe(true);
    expect(isMailLoopProgressRef("stage_play_live_source_mail_wake_result:abc")).toBe(true);
    expect(isMailLoopProgressRef("stage_play_live_source_voice_delivery_receipt:abc")).toBe(true);
    expect(isMailLoopProgressRef("helix_interim_voice_callout_receipt:abc")).toBe(true);
    expect(isMailLoopProgressRef("dottie_voice_receipt:abc")).toBe(true);
    expect(isMailLoopProgressRef("voice_receipt:abc")).toBe(true);
    expect(isMailLoopProgressRef("stage_play_live_source_mail:abc")).toBe(false);
  });

  it("preserves recursive progress ref collection and dedupe order", () => {
    const nested: Record<string, unknown> = {
      packetId: "stage_play_processed_mail_packet:1",
      text: "see stage_play_live_source_mail_decision:2 and stage_play_processed_mail_packet:1",
      child: {
        receipt_id: "voice_receipt:3",
      },
    };
    nested.self = nested;

    expect(collectMailLoopProgressRefs(nested)).toEqual([
      "stage_play_processed_mail_packet:1",
      "stage_play_live_source_mail_decision:2",
      "voice_receipt:3",
    ]);
  });

  it("preserves recursive fallback discovery for direct record refs", () => {
    expect(collectMailLoopProgressRefs({
      packetId: "",
      packet_id: "stage_play_processed_mail_packet:snake",
    })).toEqual(["stage_play_processed_mail_packet:snake"]);

    expect(collectMailLoopProgressRefs({
      packetId: null,
      packet_id: "stage_play_processed_mail_packet:snake",
    })).toEqual(["stage_play_processed_mail_packet:snake"]);
  });

  it("preserves progress-kind precedence and receipt construction", () => {
    expect(mailLoopProgressKindForRefs(["stage_play_live_source_mail_decision:1"], null)).toBe("mail_decision");
    expect(mailLoopProgressKindForRefs(["stage_play_live_source_narrative_state:1"], null)).toBe("narrative_state");
    expect(mailLoopProgressKindForRefs(["stage_play_live_source_mail_wake_result:1"], null)).toBe("wake_result");
    expect(mailLoopProgressKindForRefs(["voice_receipt:1"], null)).toBe("voice_receipt");
    expect(mailLoopProgressKindForRefs([], { voiceCandidate: true })).toBe("no_progress");
    expect(mailLoopProgressKindForRefs(["stage_play_processed_mail_packet:1"], { voiceCandidate: true })).toBe("voice_candidate");

    const buildReceipt = createMailLoopToolProgressReceiptBuilder({
      readRuntimeRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value as Record<string, unknown>
          : null,
      processedMailReadObservationNeedsProcessFallback: () => false,
      processedMailReadObservationHasPacket: () => false,
    });

    expect(buildReceipt({
      turnId: "ask:progress",
      iteration: 3,
      toolName: "live_env.read_processed_live_source_mail",
      previousRefs: new Set(["stage_play_processed_mail_packet:old"]),
      observation: {
        observation: {
          packetId: "stage_play_processed_mail_packet:new",
        },
      },
    })).toMatchObject({
      schema: "helix.mail_loop_tool_progress_receipt.v1",
      turn_id: "ask:progress",
      iteration: 3,
      toolName: "live_env.read_processed_live_source_mail",
      producedRefs: ["stage_play_processed_mail_packet:new"],
      newRefs: ["stage_play_processed_mail_packet:new"],
      progressKind: "processed_packet",
      assistant_answer: false,
      raw_content_included: false,
    });
  });

  it("preserves receipt append mutation and duplicate process fallback promotion", () => {
    const appendReceipt = createMailLoopToolProgressReceiptAppender({
      buildMailLoopToolProgressReceipt: (args) => ({
        schema: "helix.mail_loop_tool_progress_receipt.v1",
        turn_id: args.turnId,
        iteration: args.iteration,
        toolName: args.toolName,
        producedRefs: ["stage_play_processed_mail_packet:1"],
        newRefs: [],
        progressKind: "no_progress",
        assistant_answer: false,
        raw_content_included: false,
      }),
    });
    const loop = {
      tool_progress_receipts: [{
        schema: "helix.mail_loop_tool_progress_receipt.v1" as const,
        turn_id: "ask:progress",
        iteration: 1,
        toolName: "live_env.process_live_source_mail",
        producedRefs: ["stage_play_processed_mail_packet:1"],
        newRefs: ["stage_play_processed_mail_packet:1"],
        progressKind: "processed_packet" as const,
        assistant_answer: false as const,
        raw_content_included: false as const,
      }],
      mail_loop_no_progress_repeat_count: 2,
      mail_loop_continuation_wake_count: 0,
    };
    const payload = { debug: {} };
    const loopIteration = {};

    const receipt = appendReceipt({
      mailLoopContinuationBudget: { maxNoProgressRepeats: 0 },
      turnId: "ask:progress",
      iteration: 2,
      toolName: "live_env.read_processed_live_source_mail",
      observation: {},
      loop,
      payload,
      loopIteration,
    });

    expect(receipt?.progressKind).toBe("processed_packet");
    expect(loop.mail_loop_no_progress_repeat_count).toBe(0);
    expect(loop.tool_progress_receipts).toHaveLength(2);
    expect(loopIteration).toMatchObject({ tool_progress_receipt: receipt });
    expect(payload).toMatchObject({
      mail_loop_tool_progress_receipts: loop.tool_progress_receipts,
      mail_loop_continuation_budget: { maxNoProgressRepeats: 0 },
      debug: {
        mail_loop_tool_progress_receipts: loop.tool_progress_receipts,
        mail_loop_continuation_budget: { maxNoProgressRepeats: 0 },
      },
    });
  });

  it("preserves mail-loop progress stop reasons", () => {
    const resolveStopReason = createMailLoopProgressStopReasonResolver({
      hasStagePlayLiveSourceMailDecisionObservation: (artifacts) => artifacts.includes("decision"),
    });
    const noProgressReceipt = {
      schema: "helix.mail_loop_tool_progress_receipt.v1" as const,
      turn_id: "ask:progress",
      iteration: 1,
      toolName: "live_env.read_processed_live_source_mail",
      producedRefs: [],
      newRefs: [],
      progressKind: "no_progress" as const,
      assistant_answer: false as const,
      raw_content_included: false as const,
    };
    const wakeReceipt = {
      ...noProgressReceipt,
      toolName: "live_env.read_live_source_mail",
      progressKind: "wake_result" as const,
    };
    const emptyMailboxReadReceipt = {
      ...noProgressReceipt,
      toolName: "live_env.read_live_source_mail",
    };

    expect(resolveStopReason({
      mailLoopContinuationBudget: { maxNoProgressRepeats: 0, maxContinuationWakesPerCycle: 1 },
      receipt: noProgressReceipt,
      goalSatisfaction: "missing",
      currentTurnArtifacts: [],
      loop: { mail_loop_no_progress_repeat_count: 1 },
    })).toBe("mail_loop_no_progress");
    expect(resolveStopReason({
      mailLoopContinuationBudget: { maxNoProgressRepeats: 0, maxContinuationWakesPerCycle: 1 },
      receipt: emptyMailboxReadReceipt,
      goalSatisfaction: "missing",
      currentTurnArtifacts: [],
      loop: { mail_loop_no_progress_repeat_count: 1 },
    })).toBeNull();
    expect(resolveStopReason({
      mailLoopContinuationBudget: { maxNoProgressRepeats: 0, maxContinuationWakesPerCycle: 1 },
      receipt: wakeReceipt,
      goalSatisfaction: "missing",
      currentTurnArtifacts: [],
      loop: { mail_loop_continuation_wake_count: 2 },
    })).toBe("mail_loop_wake_continuation_budget_exhausted");
    expect(resolveStopReason({
      mailLoopContinuationBudget: { maxNoProgressRepeats: 0, maxContinuationWakesPerCycle: 1 },
      receipt: wakeReceipt,
      goalSatisfaction: "satisfied",
      currentTurnArtifacts: [],
      loop: { mail_loop_continuation_wake_count: 2 },
    })).toBeNull();
  });
});
