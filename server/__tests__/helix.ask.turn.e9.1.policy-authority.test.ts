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

describe("helix ask turn e9.1 planner policy authority", () => {
  it("keeps policy aligned for workspace+reasoning compare turns", async () => {
    const app = createApp();
    const sessionId = "e91-policy-hybrid-compare";
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "open docs", mode: "read", sessionId })
      .expect(200);
    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create note called e91 note", mode: "read", sessionId })
      .expect(200);
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "compare this doc with note e91 note and tell me deltas",
        mode: "read",
        sessionId,
      })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_context_reasoning");
    expect(Array.isArray(response.body?.invariant_violations)).toBe(true);
    expect(response.body?.invariant_violations ?? []).toEqual([]);
  });

  it("maps copy selection to note utterance to copy_selection_to_note action", async () => {
    const app = createApp();
    const sessionId = "e91-copy-selection-note";

    await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "create a note called test scratch", mode: "read", sessionId })
      .expect(200);

    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "copy this selection to note test scratch", mode: "read", sessionId })
      .expect(200);

    expect(response.body?.route_reason_code).toBe("dispatch:act");
    expect(response.body?.dispatch_policy).toBe("workspace_only");
    expect(response.body?.workspace_action?.panel_id).toBe("workstation-clipboard-history");
    expect(response.body?.workspace_action?.action_id).toBe("copy_selection_to_note");
    expect(response.body?.pending_server_request ?? null).toBeNull();
  });

  it("keeps pending confirm transitions typed and single-terminal", async () => {
    const app = createApp();
    const sessionId = "e91-pending-confirm";

    const confirmTurn = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "delete note throwaway", mode: "read", sessionId })
      .expect(200);

    expect(confirmTurn.body?.route_reason_code).toBe("clarify:confirmation_required");
    expect(confirmTurn.body?.pending_server_request?.kind).toBe("confirm");
    expect(confirmTurn.body?.turn_contract?.single_terminal_required).toBe(true);

    const cancelTurn = await request(app)
      .post("/api/agi/ask/turn")
      .send({ question: "no", mode: "read", sessionId })
      .expect(200);

    expect(cancelTurn.body?.pending_status_before).toBe("pending");
    expect(cancelTurn.body?.pending_status_after).toBe("canceled");
    expect(String(cancelTurn.body?.pending_transition_reason ?? "")).toContain("pending_confirmation_canceled");
    expect(cancelTurn.body?.turn_contract?.single_terminal_required).toBe(true);
    expect(cancelTurn.body?.pending_server_request ?? null).toBeNull();
  });
});
