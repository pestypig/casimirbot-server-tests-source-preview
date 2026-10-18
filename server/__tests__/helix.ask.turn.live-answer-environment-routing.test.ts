import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createApp = async (): Promise<{ app: express.Express }> => {
  const agi = await import("../routes/agi.plan");
  const app = express();
  app.use(express.json());
  app.use("/api/agi", agi.planRouter);
  return { app };
};

const actions = (body: any): any[] =>
  Array.isArray(body?.execution_trace) ? body.execution_trace.map((step: any) => step?.action).filter(Boolean) : [];

describe("helix ask live answer environment routing", () => {
  let tempLedgerDir = "";

  beforeEach(() => {
    tempLedgerDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-live-env-routing-"));
    process.env.HELIX_THREAD_LEDGER_PATH = path.join(tempLedgerDir, "helix-thread-ledger.jsonl");
    process.env.HELIX_THREAD_INDEX_PATH = path.join(tempLedgerDir, "helix-thread-index.json");
  });

  afterEach(() => {
    delete process.env.HELIX_E11_MODEL_DECISION_LLM;
    delete process.env.HELIX_E14_OBSERVATION_MODEL_DECISION;
    delete process.env.HELIX_THREAD_LEDGER_PATH;
    delete process.env.HELIX_THREAD_INDEX_PATH;
    if (tempLedgerDir) {
      fs.rmSync(tempLedgerDir, { recursive: true, force: true });
      tempLedgerDir = "";
    }
    vi.resetModules();
  });

  it("routes prompt-defined live monitor requests to the Situation Room tool", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();
    const { app } = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Watch my Minecraft run and tell me about danger or progress.",
        mode: "read",
        debug: true,
        sessionId: `live-answer-routing-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "situation-room-pipelines",
          hasSituationRoomContext: true,
        },
      })
      .expect(200);

    const action = actions(response.body).find(
      (entry) =>
        entry?.panel_id === "situation-room-pipelines" &&
        entry?.action_id === "create_live_answer_environment",
    );
    expect(action).toBeTruthy();
    expect(action?.args).toMatchObject({
      thread_id: "helix-ask:desktop",
      preset: "minecraft_run_monitor",
      room_id: "room:minecraft-minehut",
      source_ids: ["source:minecraft-server"],
    });
    expect(JSON.stringify(response.body)).not.toContain("I could not map that workspace command");
  }, 60000);

  it("routes live prime generator prompts to the calculator stream preset", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();
    const { app } = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Set up a live prime number generator and show the next primes as they are found.",
        mode: "read",
        debug: true,
        sessionId: `live-prime-routing-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
        },
      })
      .expect(200);

    const action = actions(response.body).find(
      (entry) =>
        entry?.panel_id === "situation-room-pipelines" &&
        entry?.action_id === "create_live_answer_environment",
    );
    expect(action).toBeTruthy();
    expect(action?.args).toMatchObject({
      thread_id: "helix-ask:desktop",
      preset: "calculator_prime_stream",
      source_ids: ["source:calculator-prime-stream"],
      source_config: expect.objectContaining({
        generator: "next_prime",
        primality_check: "trial_division",
      }),
    });
    expect(actions(response.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          panel_id: "scientific-calculator",
          action_id: "start_prime_stream",
          args: expect.objectContaining({
            source_id: "source:calculator-prime-stream",
            wait_for_environment: true,
          }),
        }),
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain("I could not map that workspace command");
  }, 60000);

  it("lets Helix Ask delegate commentary setup as a visible tool step", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();
    const { app } = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Set up a live prime number generator and talk me through the subgoals like Codex commentary.",
        mode: "read",
        debug: true,
        sessionId: `live-prime-commentary-routing-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
        },
      })
      .expect(200);

    expect(actions(response.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          panel_id: "situation-room-pipelines",
          action_id: "create_live_answer_environment",
        }),
        expect.objectContaining({
          panel_id: "scientific-calculator",
          action_id: "start_prime_stream",
        }),
        expect.objectContaining({
          panel_id: "situation-room-pipelines",
          action_id: "set_live_commentary_policy",
          args: expect.objectContaining({
            thread_id: "helix-ask:desktop",
            cadence: "active_dialogue",
            status: "active",
          }),
        }),
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain("I could not map that workspace command");
  }, 60000);

  it("routes commentary-only prompts to the active live environment control action", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();
    const { app } = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Enable live commentary for this environment.",
        mode: "read",
        debug: true,
        sessionId: `live-commentary-routing-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "situation-room-pipelines",
        },
      })
      .expect(200);

    const action = actions(response.body).find(
      (entry) =>
        entry?.panel_id === "situation-room-pipelines" &&
        entry?.action_id === "set_live_commentary_policy",
    );
    expect(action).toBeTruthy();
    expect(action?.args).toMatchObject({
      thread_id: "helix-ask:desktop",
      cadence: "milestones_only",
      status: "active",
    });
    expect(JSON.stringify(response.body)).not.toContain("I could not map that workspace command");
  }, 60000);

  it("routes explicit live review prompts to the agentic review workstation action", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();
    const { app } = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Explain the latest equation result in context.",
        mode: "read",
        debug: true,
        sessionId: `live-agentic-review-routing-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
        },
      })
      .expect(200);

    const action = actions(response.body).find(
      (entry) =>
        entry?.panel_id === "situation-room-pipelines" &&
        entry?.action_id === "request_agentic_review",
    );
    expect(action).toBeTruthy();
    expect(action?.args).toMatchObject({
      thread_id: "helix-ask:desktop",
      trigger: "user_direct",
      question: "Explain the latest equation result in context.",
    });
    expect(JSON.stringify(response.body)).not.toContain("I could not map that workspace command");
  }, 60000);

  it("routes keep-me-company prompts to companion policy setup", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();
    const { app } = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Dottie, keep me company while I play Minecraft but only speak for danger or progress.",
        mode: "read",
        debug: true,
        sessionId: `companion-policy-routing-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "situation-room-pipelines",
        },
      })
      .expect(200);

    const action = actions(response.body).find(
      (entry) =>
        entry?.panel_id === "situation-room-pipelines" &&
        entry?.action_id === "set_companion_policy",
    );
    expect(action).toBeTruthy();
    expect(action?.args).toMatchObject({
      thread_id: "helix-ask:desktop",
      voice_input_active: true,
      companion_mode: "active_companion",
    });
    expect(JSON.stringify(response.body)).not.toContain("I could not map that workspace command");
  }, 60000);

  it("routes live output from a prime stream to a derived workstation pipeline", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();
    const { app } = await createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Create a live output from the prime stream that tracks prime gaps.",
        mode: "read",
        debug: true,
        sessionId: `live-prime-gap-pipeline-routing-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
        },
      })
      .expect(200);

    expect(actions(response.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          panel_id: "situation-room-pipelines",
          action_id: "create_live_workstation_pipeline",
          args: expect.objectContaining({
            thread_id: "helix-ask:desktop",
            source_ids: ["source:calculator-prime-stream"],
          }),
        }),
      ]),
    );
    expect(actions(response.body).some((entry) => entry?.action_id === "create_live_answer_environment")).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain("I could not map that workspace command");
  }, 60000);

  it("does not let an active prime stream hijack unrelated concept questions", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();
    const { app } = await createApp();
    await request(app)
      .post("/api/agi/situation/live-answer-environment/create")
      .send({
        thread_id: "helix-ask:desktop",
        objective: "Set up a live prime number generator and show the next primes as they are found.",
        preset: "calculator_prime_stream",
        source_ids: ["source:calculator-prime-stream"],
        source_config: {
          generator: "next_prime",
          start: 2,
          tick_rate_ms: 1000,
          max_ticks: 100,
          primality_check: "trial_division",
        },
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What is a neutron star glitch?",
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
      })
      .expect(200);

    expect(response.body?.live_environment_turn_relevance).toMatchObject({
      relevance: "background_only",
      artifact_synthesis_allowed: false,
    });
    expect(response.body?.final_answer_source).not.toBe("artifact_synthesis");
    expect(String(response.body?.answer ?? response.body?.text ?? "")).not.toContain("Current candidate");
  }, 60000);

  it("allows explicit prime stream state questions to synthesize from the live environment", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();
    const { app } = await createApp();
    const createResponse = await request(app)
      .post("/api/agi/situation/live-answer-environment/create")
      .send({
        thread_id: "helix-ask:desktop",
        objective: "Set up a live prime number generator and show the next primes as they are found.",
        preset: "calculator_prime_stream",
        source_ids: ["source:calculator-prime-stream"],
      })
      .expect(200);
    const environmentId =
      createResponse.body?.live_answer_environment?.environment_id ??
      createResponse.body?.environment?.environment_id ??
      createResponse.body?.environment_id;
    await request(app)
      .post("/api/agi/situation/live-source/event")
      .send({
        source_id: "source:calculator-prime-stream",
        environment_id: environmentId,
        kind: "calculator_series",
        event_type: "prime_found",
        seq: 6,
        payload: {
          candidate: 7,
          is_prime: true,
          latest_prime: 7,
          prime_count: 4,
          gap: 2,
          next_candidate: 8,
          algorithm: "trial_division",
        },
        evidence_refs: ["calculator:prime:7"],
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What prime are we on?",
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
      })
      .expect(200);

    expect(response.body?.live_environment_turn_relevance).toMatchObject({
      artifact_synthesis_allowed: true,
    });
    expect(response.body?.final_answer_source).toBe("artifact_synthesis");
    expect(String(response.body?.answer ?? response.body?.text ?? "")).toContain("Current candidate");
    expect(String(response.body?.answer ?? response.body?.text ?? "")).toContain("Latest prime: 7");
  }, 60000);

  it("interprets an active Minecraft live answer environment instead of creating a new one", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();
    const { app } = await createApp();
    await request(app)
      .post("/api/agi/situation/live-answer-environment/create")
      .send({
        thread_id: "helix-ask:desktop",
        objective: "Monitor my Minecraft run and keep track of structure, risk, progress, and next checks.",
        preset: "minecraft_run_monitor",
        room_id: "room:minecraft-minehut",
        source_ids: ["source:minecraft-server"],
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Interpret the current Minecraft live environment. What is DatDamPig doing, what risks are present, and what should the workstation check next?",
        mode: "read",
        debug: true,
        context_mode: "attached",
        sessionId: "helix-ask:desktop",
        workspace_context_snapshot: {
          activePanel: "live-answer-environment",
          hasSituationRoomContext: true,
        },
      })
      .expect(200);

    const answerText = String(response.body?.answer ?? response.body?.text ?? "");
    expect(response.body?.final_answer_source).toBe("artifact_synthesis");
    expect(response.body?.terminal_artifact_kind).toBe("situation_context_pack");
    expect(answerText).toContain("Live answer environment is active");
    expect(answerText).toContain("Goal:");
    expect(answerText).not.toContain("Created a Live Answer Environment action");
    expect(actions(response.body).some((entry) => entry?.action_id === "create_live_answer_environment")).toBe(false);
    expect(response.body?.poison_audit?.ok).toBe(true);
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
  }, 60000);

  it("targets desktop live environments from unrelated UI conversation sessions", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();
    const { app } = await createApp();
    const createResponse = await request(app)
      .post("/api/agi/situation/live-answer-environment/create")
      .send({
        thread_id: "helix-ask:desktop",
        objective: "Set up a live prime number generator and show the next primes as they are found.",
        preset: "calculator_prime_stream",
        source_ids: ["source:calculator-prime-stream"],
      })
      .expect(200);
    const environmentId =
      createResponse.body?.live_answer_environment?.environment_id ??
      createResponse.body?.environment?.environment_id ??
      createResponse.body?.environment_id;
    await request(app)
      .post("/api/agi/situation/live-source/event")
      .send({
        source_id: "source:calculator-prime-stream",
        environment_id: environmentId,
        kind: "calculator_series",
        event_type: "prime_found",
        seq: 10,
        payload: {
          candidate: 11,
          is_prime: true,
          latest_prime: 11,
          prime_count: 5,
          gap: 4,
          next_candidate: 12,
          algorithm: "trial_division",
        },
        evidence_refs: ["calculator:prime:11"],
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What prime are we on?",
        mode: "read",
        debug: true,
        context_mode: "attached",
        sessionId: `ui-session-${Date.now()}`,
        workspace_context_snapshot: {
          activePanel: "scientific-calculator",
        },
      })
      .expect(200);

    expect(response.body?.live_environment_turn_relevance).toMatchObject({
      artifact_synthesis_allowed: true,
    });
    expect(response.body?.terminal_artifact_kind).toBe("situation_context_pack");
    expect(response.body?.final_answer_source).toBe("artifact_synthesis");
    expect(String(response.body?.answer ?? response.body?.text ?? "")).toContain("Latest prime: 11");
  }, 60000);

  it("exposes line-level workstation tool requests on Minecraft live situation answers", async () => {
    process.env.HELIX_E11_MODEL_DECISION_LLM = "0";
    process.env.HELIX_E14_OBSERVATION_MODEL_DECISION = "0";
    vi.resetModules();
    const { app } = await createApp();
    await request(app)
      .post("/api/agi/situation/live-answer-environment/create")
      .send({
        thread_id: "helix-ask:desktop",
        objective: "Monitor my Minecraft run and keep track of structure, risk, progress, and next checks.",
        preset: "minecraft_run_monitor",
        room_id: "room:minecraft-minehut",
        source_ids: ["source:minecraft-server"],
      })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "What is my current Minecraft live situation and what should the workstation check next?",
        mode: "read",
        debug: true,
        sessionId: "helix-ask:desktop",
      })
      .expect(200);

    expect(response.body?.final_answer_source).toBe("artifact_synthesis");
    expect(response.body?.terminal_artifact_kind).toBe("situation_context_pack");
    expect(response.body?.line_tool_request_count).toBeGreaterThan(0);
    expect(response.body?.live_line_tool_requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schema: "helix.live_line_tool_request.v1",
          requested_tool: "minecraft.query_event_window",
          assistant_answer: false,
          raw_content_included: false,
        }),
      ]),
    );
    expect(response.body?.debug?.line_tool_request_count).toBe(response.body?.line_tool_request_count);
    expect(response.body?.poison_audit?.ok).toBe(true);
    expect(response.body?.terminal_answer_authority?.server_authoritative).toBe(true);
  }, 60000);
});
