import { beforeEach, describe, expect, it } from "vitest";
import type { HelixLiveFieldEvaluation } from "@shared/helix-live-field-evaluation";
import type { HelixLiveProcedureEpoch } from "@shared/helix-live-procedure-epoch";
import type { HelixObservationJournalEntry } from "@shared/helix-observation-journal";
import {
  buildVerifiedVoiceCalloutCandidates,
  repairLiveFieldEvaluations,
  repairSceneFields,
  resetFieldRepairArtifactsForTest,
  type EvidenceRef,
  type SceneFields,
} from "../services/situation-room/scene-field-repair";
import {
  listVisualSceneMemory,
  recordVisualSceneMemoryIndex,
  resetVisualSceneMemoryForTest,
} from "../services/situation-room/visual-scene-memory-store";

const ocr = (texts: string[], frameId = "frame:test"): EvidenceRef[] =>
  texts.map((text, index) => ({
    id: `ocr:${index}`,
    kind: "ocr_text",
    text,
    source_frame_id: frameId,
    score: 0.9,
  }));

const repair = (initialFields: SceneFields, texts: string[], frameId = "frame:test") =>
  repairSceneFields({
    frameId,
    initialFields,
    ocrEvidence: ocr(texts, frameId),
    visualEvidence: [],
  });

describe("scene field repair", () => {
  beforeEach(() => {
    resetFieldRepairArtifactsForTest();
    resetVisualSceneMemoryForTest();
  });

  it("repairs Task Manager object and activity contradictions", () => {
    const output = repair({
      scene_summary: "Windows Task Manager is open, showing Users or Performance information.",
      activity: "viewing a browser tab",
      objects: ["browser tab", "web page", "address bar"],
      activity_confidence: 0.73,
      objects_confidence: 0.78,
    }, ["Task Manager", "Users", "Performance", "CPU", "Memory", "Disk", "Network", "GPU"], "frame:task-manager");

    expect(output.repairedFields.app_window?.app_id).toBe("windows_task_manager");
    expect(output.repairArtifact.assistant_answer).toBe(false);
    expect(output.repairArtifact.contradiction_refs.map((entry) => entry.contradiction_type)).toEqual(expect.arrayContaining([
      "cross_app_object",
      "app_activity_mismatch",
    ]));
    expect(output.repairedFields.objects).toEqual(expect.arrayContaining([
      "Windows Task Manager",
      "Users tab",
      "Performance tab",
      "CPU metrics",
      "Memory metrics",
      "Disk metrics",
      "Network metrics",
      "GPU metrics",
      "user row",
      "resource columns",
    ]));
    expect(output.repairedFields.objects).not.toEqual(expect.arrayContaining(["browser tab", "web page", "address bar"]));
    expect(output.repairedFields.activity).toMatch(/Windows Task Manager resource or user information/i);
    expect(output.repairArtifact.confidence_changes.find((entry) => entry.field === "objects")?.new_confidence).toBeGreaterThan(0.6);
    expect(output.repairArtifact.caveated_fields).toEqual(expect.arrayContaining(["active_tab_or_pane"]));
  });

  it("repairs File Explorer fields misread as browser vocabulary", () => {
    const output = repair({
      scene_summary: "File Explorer is open to a folder.",
      activity: "viewing a web page",
      objects: ["browser tab", "URL bar", "web page"],
    }, ["File Explorer", "This PC", "Downloads", "Name", "Date modified", "Type", "Size"]);

    expect(output.repairedFields.app_window?.app_id).toBe("file_explorer");
    expect(output.repairedFields.objects).toEqual(expect.arrayContaining([
      "File Explorer",
      "navigation pane",
      "breadcrumb path",
      "folder list",
      "file list",
      "details columns",
    ]));
    expect(output.repairedFields.objects?.join(" ")).not.toMatch(/browser tab|webpage/i);
    expect(output.repairedFields.activity).toMatch(/files or folders/i);
    expect(output.repairArtifact.contradiction_refs.some((entry) => entry.contradicted_claim === "browser tab")).toBe(true);
  });

  it("preserves a supported browser scene", () => {
    const output = repair({
      scene_summary: "A web browser is open.",
      activity: "viewing a web page",
      objects: ["browser tab", "address bar", "webpage", "link"],
      activity_confidence: 0.72,
      objects_confidence: 0.74,
    }, ["https://example.com", "Back", "Reload", "Search"]);

    expect(output.repairedFields.app_window?.app_id).toBe("browser");
    expect(output.repairArtifact.contradiction_refs).toEqual([]);
    expect(output.repairArtifact.repair_method).toBe("no_repair_needed");
    expect(output.repairedFields.objects).toEqual(expect.arrayContaining(["browser tab", "address bar", "webpage"]));
    expect(output.repairedFields.objects_confidence).toBe(0.74);
  });

  it("repairs a browser scene with File Explorer hallucinated objects", () => {
    const output = repair({
      scene_summary: "A browser window is open on a website.",
      activity: "viewing files in a folder",
      objects: ["file row", "folder list", "details columns"],
    }, ["https://", "Reload", "Bookmarks", "Search", "Sign in"]);

    expect(output.repairedFields.app_window?.app_id).toBe("browser");
    expect(output.repairArtifact.contradiction_refs.map((entry) => entry.contradiction_type)).toContain("cross_app_object");
    expect(output.repairedFields.activity).toBe("viewing a web page");
    expect(output.repairedFields.objects).toEqual(expect.arrayContaining(["web browser", "browser tab", "address bar", "webpage"]));
    expect(output.repairedFields.objects?.join(" ")).not.toMatch(/folder list/i);
  });

  it("repairs Calculator contradictions", () => {
    const output = repair({
      scene_summary: "Windows Calculator is open.",
      activity: "editing spreadsheet cells",
      objects: ["spreadsheet cells", "grid", "formula bar"],
    }, ["Standard", "MC", "MR", "M+", "7", "8", "9", "+", "=", "0", "Calculator"]);

    expect(output.repairedFields.app_window?.app_id).toBe("calculator");
    expect(output.repairArtifact.contradiction_refs.map((entry) => entry.contradiction_type)).toEqual(expect.arrayContaining([
      "app_activity_mismatch",
      "impossible_ui_element",
    ]));
    expect(output.repairedFields.objects).toEqual(expect.arrayContaining([
      "Windows Calculator",
      "calculator display",
      "numeric keypad",
      "operator buttons",
      "equals button",
    ]));
    expect(output.repairedFields.objects?.join(" ")).not.toMatch(/spreadsheet cells|formula bar/i);
    expect(output.repairedFields.activity).toMatch(/calculator/i);
  });

  it("downgrades unknown app scenes without over-repairing", () => {
    const output = repair({
      scene_summary: "An application window is visible.",
      activity: "possibly browsing or editing content",
      objects: ["browser tab", "document area"],
    }, ["Settings", "Panel", "Status"]);

    expect(output.repairedFields.app_window?.app_id).toBe("unknown_app");
    expect(output.repairedFields.app_window?.confidence).toBeLessThan(0.55);
    expect(output.repairedFields.objects).toEqual(expect.arrayContaining(["application window", "panel", "status area"]));
    expect(output.repairedFields.objects?.join(" ")).not.toMatch(/Task Manager|File Explorer|Windows Calculator/i);
    expect(output.repairedFields.objects?.join(" ")).not.toMatch(/browser tab/i);
    expect(output.repairArtifact.caveated_fields).toEqual(expect.arrayContaining(["app_window"]));
  });

  it("keeps contradicted raw object fields out of scene memory", () => {
    const rawEvaluations = [
      liveEval("scene", "Windows Task Manager is open, showing Users or Performance information.", 0.82),
      liveEval("activity", "viewing a browser tab", 0.73),
      liveEval("objects", "browser tab, web page, address bar", 0.78),
    ];
    const repaired = repairLiveFieldEvaluations({
      frameId: "observation:task-manager-memory",
      observationText: "Windows Task Manager is open, showing Users or Performance information. CPU Memory Disk Network GPU.",
      evaluations: rawEvaluations,
      ocrEvidence: ocr(["Task Manager", "Users", "Performance", "CPU", "Memory", "Disk", "Network", "GPU"], "observation:task-manager-memory"),
    });
    recordVisualSceneMemoryIndex({
      situationRunId: "situation:memory",
      threadId: "thread:memory",
      environmentId: "env:memory",
      epoch: 1,
      observation: observation("observation:task-manager-memory"),
      evaluations: repaired.evaluations,
      procedureEpoch: procedureEpoch(repaired.evaluations.map((entry) => entry.evaluation_id)),
    });

    const memory = listVisualSceneMemory({ threadId: "thread:memory", situationRunId: "situation:memory", limit: 1 })[0];
    expect(memory.objects).toEqual(expect.arrayContaining([
      "Windows Task Manager",
      "Users tab",
      "Performance tab",
      "CPU metrics",
      "Memory metrics",
      "Disk metrics",
      "Network metrics",
      "GPU metrics",
      "user row",
      "resource columns",
    ]));
    expect(memory.objects.join(" ")).not.toMatch(/browser tab|web page|address bar/i);
    expect(memory.semantic_tags).toEqual(expect.arrayContaining(["task_manager", "windows task manager"]));
    expect(repaired.repairArtifact.original_fields.objects).toEqual(["browser tab", "web page", "address bar"]);
  });

  it("builds voice callouts from verified repaired fields only", () => {
    const output = repair({
      scene_summary: "Windows Task Manager is open, showing Users or Performance information.",
      activity: "viewing a browser tab",
      objects: ["browser tab", "web page", "address bar"],
    }, ["Task Manager", "Users", "Performance", "CPU", "Memory", "Disk", "Network", "GPU"]);

    const callouts = buildVerifiedVoiceCalloutCandidates(output);
    expect(callouts.length).toBeGreaterThan(0);
    expect(callouts.every((entry) => entry.uses_verified_fields_only)).toBe(true);
    expect(callouts.map((entry) => entry.text).join(" ")).toMatch(/Task Manager/i);
    expect(callouts.map((entry) => entry.text).join(" ")).not.toMatch(/browser tab/i);
    expect(callouts.map((entry) => entry.text).join(" ")).not.toMatch(/You're on the Performance tab/i);
  });
});

const liveEval = (fieldKey: string, value: string, confidence: number): HelixLiveFieldEvaluation => ({
  schema: "helix.live_field_evaluation.v1",
  evaluation_id: `live_field_eval:${fieldKey}`,
  worker_run_id: `worker_run:${fieldKey}`,
  worker_id: `worker:${fieldKey}`,
  situation_run_id: "situation:memory",
  thread_id: "thread:memory",
  environment_id: "env:memory",
  field_key: fieldKey,
  value,
  status: "supported",
  confidence,
  evidence_refs: ["observation:task-manager-memory"],
  missing_evidence: [],
  corroboration_state: {
    visual_frame: "present",
    audio_transcript: "missing_not_required",
    user_steering: "missing_not_required",
    world_event: "not_applicable",
  },
  next_check: "Compare the next frame.",
  expires_at: "2026-05-19T12:00:45.000Z",
  created_at: "2026-05-19T12:00:00.000Z",
  role: "ui_projection",
  assistant_answer: false,
  raw_content_included: false,
});

const observation = (id: string): HelixObservationJournalEntry => ({
  schema: "helix.observation_journal_entry.v1",
  observation_id: id,
  thread_id: "thread:memory",
  source_id: "source:visual",
  source_binding_id: "source_binding:memory",
  source_identity_ref: "live_source_identity:memory",
  source_epoch: 1,
  source_seq: 1,
  modality: "visual_frame",
  text: "Windows Task Manager is open, showing Users or Performance information. CPU Memory Disk Network GPU.",
  confidence: 0.82,
  evidence_refs: [id],
  model_invoked: true,
  observed_at: "2026-05-19T12:00:00.000Z",
  ingested_at: "2026-05-19T12:00:00.000Z",
  available_at: "2026-05-19T12:00:00.000Z",
  created_at: "2026-05-19T12:00:00.000Z",
  assistant_answer: false,
  raw_content_included: false,
  context_policy: "compact_context_pack_only",
  role: "model_perception_observation",
});

const procedureEpoch = (fieldEvaluationRefs: string[]): HelixLiveProcedureEpoch => ({
  schema: "helix.live_procedure_epoch.v1",
  epoch_id: "live_procedure_epoch:memory",
  situation_run_id: "situation:memory",
  thread_id: "thread:memory",
  environment_id: "env:memory",
  source_binding_id: "source_binding:memory",
  epoch: 1,
  observation_refs: ["observation:task-manager-memory"],
  field_evaluation_refs: fieldEvaluationRefs,
  prediction_refs: [],
  probe_result_refs: [],
  assistant_answer: false,
  raw_content_included: false,
  role: "validation",
  created_at: "2026-05-19T12:00:00.000Z",
});
