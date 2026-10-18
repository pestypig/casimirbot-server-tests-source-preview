import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";
import { buildHelixAskPublicCommentaryTimeline } from "../services/helix-ask/public-commentary-timeline";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const grRefractionPrompt =
  'In general relativity, do light cones at each point in space time deal with refraction indexes of materials, and if e=hf as Penrose puts it "mass clock" does the super position of matter have impact on refraction of light and what does this mean for the expanding light cone at the points representing the matter in space and time geometry hyper surface?';

const photonCalculatorPrompt =
  "Use the scientific calculator to compute photon energy for 500 nm light in joules and eV, and explain what the result means.";

const naturalCompoundCalculatorPrompt =
  "Use calculator compute frequency from 500 nm then energy J then eV";

const docsViewerCapabilityPrompt =
  "Docs Viewer: strongest dynamic surface. All 14 dynamic actions have some test evidence; core actions like open, locate_in_doc, summarize_doc, search_docs, and explain_paper are well represented.";

const photonCalculatorPlannerFixture = {
  subgoals: [
    {
      id: "calculate_frequency",
      label: "Calculate the frequency of the photon",
      expression: "3e8/(500e-9)",
      expected_quantity: "frequency",
      expected_unit: "Hz",
      equation: "f = c / lambda",
    },
    {
      id: "calculate_photon_energy_joules",
      label: "Calculate the photon energy in joules",
      expression: "6.62607015e-34*(3e8/(500e-9))",
      expected_quantity: "energy",
      expected_unit: "J",
      equation: "E = h f",
      depends_on: ["calculate_frequency"],
    },
    {
      id: "calculate_photon_energy_ev",
      label: "Convert photon energy to eV",
      expression: "(6.62607015e-34*(3e8/(500e-9)))/(1.602176634e-19)",
      expected_quantity: "energy",
      expected_unit: "eV",
      depends_on: ["calculate_photon_energy_joules"],
    },
  ],
};

const parseSseEvents = (text: string): Array<{ event: string; data: any }> =>
  text
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!event || !data) return null;
      return { event, data: JSON.parse(data) };
    })
    .filter(Boolean) as Array<{ event: string; data: any }>;

describe("helix ask public commentary stream", () => {
  it("does not keep stale fail-closed commentary after terminal authority selects a successful answer", () => {
    const timeline = buildHelixAskPublicCommentaryTimeline({
      turnId: "ask:public-commentary-terminal-success",
      traceId: "ask:public-commentary-terminal-success",
      prompt:
        "Use helix_ask.reflect_theory_context to reflect on how the Alcubierre metric connects to terminal authority.",
      turnEvents: [
        {
          type: "observation_recorded",
          actual_artifacts: ["helix_theory_context_reflection_tool_receipt"],
        },
      ],
      terminalAuthority: {
        terminal_artifact_kind: "model_synthesized_answer",
        final_answer_source: "final_answer_draft",
        server_authoritative: true,
      },
      goalSatisfactionEvaluation: {
        status: "satisfied",
      },
      finalStatus: "final_failure",
    });

    const timelineText = timeline.map((event) => `${event.timing} ${event.status} ${event.text}`).join("\n");

    expect(timeline.at(-1)).toMatchObject({
      timing: "final_ready",
      status: "done",
    });
    expect(timelineText).not.toMatch(/fail_closed|cannot safely present|typed failure path|solver_path_incomplete/i);
  });

  it("projects natural public commentary before terminal output for model-only physics turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: grRefractionPrompt,
        mode: "read",
        sessionId: `public-commentary-${Date.now()}`,
        debug: true,
      })
      .expect(200);

    const events = Array.isArray(response.body?.turn_events) ? response.body.turn_events : [];
    const terminalIndex = events.findIndex((event: any) => event?.type === "terminal_answer");
    const commentaryIndex = events.findIndex((event: any) => event?.type === "public_commentary");
    expect(commentaryIndex).toBeGreaterThanOrEqual(0);
    expect(terminalIndex).toBeGreaterThan(commentaryIndex);

    const timeline = Array.isArray(response.body?.public_commentary_timeline)
      ? response.body.public_commentary_timeline
      : [];
    expect(timeline.length).toBeGreaterThan(0);
    expect(response.body?.debug?.public_commentary_timeline).toEqual(timeline);
    expect(timeline[0]).toMatchObject({
      schema: "helix.ask_public_commentary_event.v1",
      timing: "turn_start",
      assistant_answer: false,
      raw_reasoning_included: false,
    });
    expect(timeline[0].text).toMatch(/separating|splitting/i);
    expect(timeline[0].text).toMatch(/light cones/i);
    expect(timeline[0].text).toMatch(/refraction/i);
    expect(timeline[0].text.trim()).not.toMatch(/^[{[]/);
    expect(timeline.map((event: any) => event.text).join("\n")).not.toMatch(
      /turn_purpose|why_this_capability|expected_artifacts|observation_summary/i,
    );

    const transcriptText = (response.body?.turn_transcript_events ?? [])
      .map((event: any) => event?.text)
      .join("\n");
    expect(transcriptText).toContain(timeline[0].text);
    expect(response.body?.terminal_answer_authority ?? response.body?.terminal_authority).toBeTruthy();
  });

  it("emits public commentary as live transcript events before the final stream payload", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question: grRefractionPrompt,
        mode: "read",
        sessionId: `public-commentary-stream-${Date.now()}`,
        debug: true,
      })
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/text\/event-stream/);
    const events = parseSseEvents(response.text ?? "");
    const liveTranscriptEvents = events
      .filter((event) => event.event === "turn_transcript_event")
      .map((event) => event.data);
    const finalIndex = events.findIndex((event) => event.event === "turn_final");
    const commentaryIndex = events.findIndex(
      (event) => event.event === "turn_transcript_event" && event.data?.type === "public_commentary",
    );
    expect(commentaryIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex).toBeGreaterThan(commentaryIndex);
    expect(liveTranscriptEvents[0]?.type).toBe("public_commentary");
    expect(liveTranscriptEvents[0]?.text).not.toMatch(/Starting Helix Ask turn|Completed step model_only_reasoning/i);

    const commentary = events[commentaryIndex]?.data;
    expect(commentary?.text).toMatch(/light cones|refraction|draft answer|optical paths/i);
    expect(commentary?.text).not.toMatch(/turn_purpose|why_this_capability|expected_artifacts|observation_summary/i);

    const finalPacket = events.findLast((event) => event.event === "turn_final")?.data;
    const timeline = Array.isArray(finalPacket?.public_commentary_timeline)
      ? finalPacket.public_commentary_timeline
      : [];
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline.some((event: any) => event?.text === commentary?.text)).toBe(true);
  });

  it("carries streamed transcript rows into the final payload for Docs Viewer capability label turns", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question: docsViewerCapabilityPrompt,
        mode: "read",
        sessionId: `public-commentary-docs-label-stream-${Date.now()}`,
        debug: true,
      })
      .expect(200);

    const events = parseSseEvents(response.text ?? "");
    const finalIndex = events.findIndex((event) => event.event === "turn_final");
    const commentaryIndex = events.findIndex(
      (event) => event.event === "turn_transcript_event" && event.data?.type === "public_commentary",
    );
    const finalPacket = events.findLast((event) => event.event === "turn_final")?.data;
    const finalTranscriptRows = Array.isArray(finalPacket?.turn_transcript_events)
      ? finalPacket.turn_transcript_events
      : [];
    const finalMeaningfulRows = finalTranscriptRows.filter(
      (row: any) => !["question", "final_answer", "turn_completed"].includes(row?.type),
    );
    const finalTranscriptText = finalTranscriptRows.map((row: any) => row?.text).join("\n");

    expect(commentaryIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex).toBeGreaterThan(commentaryIndex);
    expect(finalMeaningfulRows.length).toBeGreaterThan(0);
    expect(finalMeaningfulRows.some((row: any) => row?.type === "public_commentary")).toBe(true);
    expect(finalPacket?.debug?.turn_transcript_events?.length).toBe(finalTranscriptRows.length);
    expect(finalTranscriptText).not.toMatch(
      /turn_purpose|why_this_capability|expected_artifacts|observation_summary/i,
    );
  }, 20_000);

  it("streams compound calculator commentary across plan, receipt, validation, and synthesis", async () => {
    const app = createApp();
    const previousPlannerResponse = process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
    process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = JSON.stringify(photonCalculatorPlannerFixture);
    let response: any;
    try {
      response = await request(app)
        .post("/api/agi/ask/turn/stream")
        .send({
          question: photonCalculatorPrompt,
          mode: "read",
          sessionId: `public-commentary-calculator-${Date.now()}`,
          debug: true,
        })
        .expect(200);
    } finally {
      if (previousPlannerResponse === undefined) delete process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = previousPlannerResponse;
    }

    const events = parseSseEvents(response.text ?? "");
    const transcriptRows = events
      .filter((event) => event.event === "turn_transcript_event")
      .map((event) => event.data);
    const commentaryRows = transcriptRows.filter((row) => row?.type === "public_commentary");
    const finalPacket = events.findLast((event) => event.event === "turn_final")?.data;
    const timeline = Array.isArray(finalPacket?.public_commentary_timeline)
      ? finalPacket.public_commentary_timeline
      : [];
    const timelineText = timeline.map((event: any) => event?.text).join("\n");

    expect(commentaryRows.length).toBeGreaterThanOrEqual(5);
    expect(commentaryRows[0]?.text).toMatch(/calculator-backed/i);
    expect(timeline.length).toBeGreaterThanOrEqual(5);
    expect(timelineText).toMatch(/calculator-backed|calculator subgoal|numeric/i);
    expect(timelineText).toMatch(/photon energy|joule/i);
    expect(timelineText).toMatch(/eV|electronvolt/i);
    expect(timelineText).toMatch(/receipt|validation|unit/i);
    expect(timelineText).toMatch(/synthesizing|explanation/i);
    expect(timelineText).not.toMatch(/6e\+14 m|checking that it is length/i);
    expect(timelineText).not.toMatch(/turn_purpose|why_this_capability|expected_artifacts|observation_summary/i);
    expect(timeline.some((event: any) =>
      Array.isArray(event?.evidence_refs) &&
      event.evidence_refs.some((ref: string) => /receipt|validation|workstation_tool_evaluation/i.test(ref)),
    )).toBe(true);
    expect(["workstation_tool_evaluation", "model_synthesized_answer"]).toContain(finalPacket?.terminal_artifact_kind);
    expect(String(finalPacket?.final_answer_source ?? "")).toMatch(/workstation_tool_evaluation|final_answer_draft|model_synth/i);
  });

  it("keeps non-stream debug and transcript commentary aligned for natural compound calculator prompts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: naturalCompoundCalculatorPrompt,
        mode: "read",
        sessionId: `public-commentary-natural-calculator-${Date.now()}`,
        debug: true,
      })
      .expect(200);

    const timeline = Array.isArray(response.body?.public_commentary_timeline)
      ? response.body.public_commentary_timeline
      : [];
    const transcriptRows = Array.isArray(response.body?.turn_transcript_events)
      ? response.body.turn_transcript_events
      : [];
    const commentaryRows = transcriptRows.filter((row: any) => row?.type === "public_commentary");
    const timelineText = timeline.map((event: any) => event?.text).join("\n");
    const transcriptText = commentaryRows.map((event: any) => event?.text).join("\n");

    expect(timeline.length).toBeGreaterThanOrEqual(6);
    expect(response.body?.debug?.public_commentary_timeline).toEqual(timeline);
    expect(commentaryRows.length).toBeGreaterThanOrEqual(6);
    expect(commentaryRows[0]?.text).toMatch(/calculator-backed/i);
    expect(timelineText).toMatch(/planned 3 calculator subgoals/i);
    expect(timelineText).toMatch(/frequency/i);
    expect(timelineText).toMatch(/Hz/i);
    expect(timelineText).toMatch(/joules?|J/i);
    expect(timelineText).toMatch(/eV|electronvolt/i);
    expect(timelineText).toMatch(/receipts passed|validation/i);
    expect(timelineText).toMatch(/synthesizing/i);
    expect(`${timelineText}\n${transcriptText}`).not.toMatch(/Blocked:|fail_closed|cannot safely present/i);
    expect(["workstation_tool_evaluation", "model_synthesized_answer"]).toContain(response.body?.terminal_artifact_kind);
    expect(String(response.body?.final_answer_source ?? "")).toMatch(/workstation_tool_evaluation|final_answer_draft|model_synth/i);
  }, 20_000);

  it("summarizes the previous Ask turn debug trace through the local Ask route without mission preflight", async () => {
    const app = createApp();
    const sessionId = `public-commentary-history-${Date.now()}`;
    const previousPlannerResponse = process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
    process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = JSON.stringify(photonCalculatorPlannerFixture);
    let priorResponse: request.Response;
    try {
      priorResponse = await request(app)
        .post("/api/agi/ask/turn")
        .send({
          question: naturalCompoundCalculatorPrompt,
          mode: "read",
          sessionId,
          debug: true,
        })
        .expect(200);
    } finally {
      if (previousPlannerResponse === undefined) delete process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE;
      else process.env.HELIX_CALCULATOR_PLANNER_TEST_RESPONSE = previousPlannerResponse;
    }
    expect(priorResponse.body?.public_commentary_timeline?.length).toBeGreaterThanOrEqual(6);

    const turnResponse = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Inspect the last Helix Ask turn and summarize route tool receipt final source",
        mode: "observe",
        sessionId,
        debug: true,
      })
      .expect(200);
    expect(turnResponse.body?.text).toMatch(/Previous Ask turn summary/i);
    expect(turnResponse.body?.text).toMatch(/Receipts:/i);
    expect(turnResponse.body?.text).toMatch(/compute frequency: 6e\+14 Hz/i);
    expect(turnResponse.body?.text).toMatch(/compute energy in joules: 3\.975642e-19 J/i);
    expect(turnResponse.body?.text).toMatch(/convert energy to eV: 2\.48140061815 eV/i);
    expect(turnResponse.body?.text).toMatch(/Validation: 3 validation checks passed/i);
    expect(turnResponse.body?.text).not.toMatch(/Mission interface blocked|preflight gate|runtime authority checks failed/i);
    expect(turnResponse.body?.final_answer_source).toBe("ask_debug_history_summary");
    expect(turnResponse.body?.terminal_artifact_kind).toBe("ask_debug_history_summary");
    expect(turnResponse.body?.resolved_turn_summary).toMatchObject({
      terminal_artifact_kind: "ask_debug_history_summary",
    });
    expect(turnResponse.body?.terminal_answer_authority).toMatchObject({
      final_answer_source: "ask_debug_history_summary",
      terminal_artifact_kind: "ask_debug_history_summary",
      server_authoritative: true,
    });
    expect(turnResponse.body?.route_authority_audit).toMatchObject({
      route_authority_ok: true,
    });
    expect(turnResponse.body?.solver_controller_decision).toMatchObject({
      decision: "allow_terminal",
      selected_terminal_artifact_kind: "ask_debug_history_summary",
    });

    const turnDebugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(String(turnResponse.body?.turn_id))}/debug-export`)
      .expect(200);
    expect(turnDebugExport.body?.payload?.resolved_turn_summary).toMatchObject({
      terminal_artifact_kind: "ask_debug_history_summary",
    });
    expect(turnDebugExport.body?.payload?.terminal_answer_authority).toMatchObject({
      final_answer_source: "ask_debug_history_summary",
      terminal_artifact_kind: "ask_debug_history_summary",
      server_authoritative: true,
    });
    expect(turnDebugExport.body?.payload?.solver_controller_summary).toMatchObject({
      route_authority_ok: true,
      selected_terminal_artifact_kind: "ask_debug_history_summary",
    });

    const response = await request(app)
      .post("/api/agi/ask")
      .send({
        question: "Inspect the last Helix Ask turn and summarize route tool receipt final source",
        mode: "observe",
        sessionId,
        debug: true,
      })
      .expect(200);

    expect(response.body?.text).toMatch(/Previous Ask turn summary/i);
    expect(response.body?.text).toMatch(/Route:/i);
    expect(response.body?.text).toMatch(/Tool\/action:/i);
    expect(response.body?.text).toMatch(/Receipts:/i);
    expect(response.body?.text).toMatch(/compute frequency: 6e\+14 Hz/i);
    expect(response.body?.text).toMatch(/compute energy in joules: 3\.975642e-19 J/i);
    expect(response.body?.text).toMatch(/convert energy to eV: 2\.48140061815 eV/i);
    expect(response.body?.text).toMatch(/Validation: 3 validation checks passed/i);
    expect(response.body?.text).toMatch(/Final source:/i);
    expect(response.body?.text).not.toMatch(/Mission interface blocked|preflight gate/i);
    expect(response.body?.final_answer_source).toBe("ask_debug_history_summary");
    expect(response.body?.terminal_artifact_kind).toBe("ask_debug_history_summary");
    const legacySummaryArtifact = Array.isArray(response.body?.current_turn_artifact_ledger)
      ? response.body.current_turn_artifact_ledger.find((artifact: any) => artifact?.kind === "ask_debug_history_summary")
      : null;
    expect(legacySummaryArtifact?.payload).toMatchObject({
      schema: "helix.ask_debug_history_summary.v1",
      inspected_turn_id: priorResponse.body?.turn_id,
      assistant_answer: false,
      raw_reasoning_included: false,
    });
    const timeline = Array.isArray(response.body?.public_commentary_timeline)
      ? response.body.public_commentary_timeline
      : [];
    expect(timeline.some((event: any) => /prior Ask debug envelope/i.test(event?.text))).toBe(true);
    expect(timeline.map((event: any) => event?.text).join("\n")).not.toMatch(
      /turn_purpose|why_this_capability|observation_summary/i,
    );
  }, 20_000);

  it("projects document evidence turns as public commentary before generic lifecycle rows", async () => {
    const app = createApp();
    const sessionId = `public-commentary-docs-${Date.now()}`;
    const response = await request(app)
      .post("/api/agi/ask/turn/stream")
      .send({
        question: "What is this doc about?",
        mode: "read",
        sessionId,
        debug: true,
        workspace_context_snapshot: {
          sessionId,
          activePanel: "docs-viewer",
          activeDocPath: "/docs/research/example.md",
          hasDocContext: true,
        },
      })
      .expect(200);

    const events = parseSseEvents(response.text ?? "");
    const transcriptRows = events
      .filter((event) => event.event === "turn_transcript_event")
      .map((event) => event.data);
    const firstVisible = transcriptRows[0];
    const finalPacket = events.findLast((event) => event.event === "turn_final")?.data;
    const timelineText = (finalPacket?.public_commentary_timeline ?? [])
      .map((event: any) => event?.text)
      .join("\n");

    expect(firstVisible?.type).toBe("public_commentary");
    expect(timelineText).toMatch(/document tool|document evidence|docs/i);
    expect(timelineText).toMatch(/evidence|summary|covers/i);
    expect(firstVisible?.text).not.toMatch(/Starting Helix Ask turn|Completed step/i);
  });
});
