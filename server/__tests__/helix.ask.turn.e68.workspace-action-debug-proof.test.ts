import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { planRouter } from "../routes/agi.plan";

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

describe("helix ask E68 workspace action debug proof", () => {
  it("includes receipt proof for Scientific Calculator workspace actions", async () => {
    const app = createApp();
    const turn = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Scientific Calculator",
        mode: "read",
        debug: true,
        sessionId: `e68-proof-${Date.now()}`,
      })
      .expect(200);

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turn.body.turn_id)}/debug-export`)
      .expect(200);

    const workspace = debugExport.body?.payload?.workspace_action_debug;
    const proof = workspace?.workspace_action_debug_proof;
    expect(workspace?.workspace_action_receipt?.target_id).toBe("scientific-calculator");
    expect(workspace?.workspace_action_registry_audit?.verdict).toBe("clean");
    expect(workspace?.anti_determinism_audit?.verdict).toBe("clean");
    expect(proof?.lifecycle_events_present).toEqual(
      expect.arrayContaining(["workspace_action/started", "workspace_action/dispatched", "workspace_action/completed"]),
    );
    expect(proof?.registry_verdict).toBe("clean");
    expect(proof?.anti_determinism_verdict).toBe("clean");
    expect(proof?.final_answer_receipt_backed).toBe(true);
  }, 60000);

  it("exports unknown panel typed failures without document recovery", async () => {
    const app = createApp();
    const turn = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Panel Quantum Banana Shelf",
        mode: "read",
        debug: true,
        sessionId: `e68-unknown-${Date.now()}`,
      })
      .expect(200);

    const debugExport = await request(app)
      .get(`/api/agi/ask/turn/${encodeURIComponent(turn.body.turn_id)}/debug-export`)
      .expect(200);

    expect(debugExport.body?.payload?.resolved_turn_summary?.terminal_artifact_kind).toBe("typed_failure");
    expect(debugExport.body?.payload?.resolved_turn_summary?.terminal_error_code).toBe("workspace_action_unknown");
    expect(JSON.stringify(debugExport.body.payload)).not.toContain("document_summary_recovery_failed");
    expect(JSON.stringify(debugExport.body.payload)).not.toContain("terminal_consistency_violation");
  }, 60000);
});
