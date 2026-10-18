import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const chatSessionDbMock = vi.hoisted(() => ({
  deleteChatSessionById: vi.fn(),
  getChatSessionById: vi.fn(),
  listChatSessionsByOwner: vi.fn(),
  upsertChatSession: vi.fn(),
}));

const rollingContextMock = vi.hoisted(() => ({
  forgetHelixRollingSessionContextPacket: vi.fn(),
}));

vi.mock("../db/chatSessions", () => chatSessionDbMock);
vi.mock("../services/helix-ask/rolling-session-context", () => rollingContextMock);

const buildApp = async () => {
  const { chatRouter } = await import("../routes/agi.chat");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/agi", chatRouter);
  return app;
};

describe("agi chat delete route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a chat session without leaking storage failures into process-level rejections", async () => {
    chatSessionDbMock.deleteChatSessionById.mockRejectedValueOnce(new Error("database unavailable"));
    const app = await buildApp();

    const unhandled = vi.fn();
    process.once("unhandledRejection", unhandled);
    try {
      const response = await request(app).delete("/api/agi/chat/sessions/chat-delete").expect(500);

      expect(response.body).toEqual({ error: "delete_failed" });
      expect(rollingContextMock.forgetHelixRollingSessionContextPacket).toHaveBeenCalledWith({
        threadId: "chat-delete",
        sessionId: "chat-delete",
      });
      expect(chatSessionDbMock.deleteChatSessionById).toHaveBeenCalledWith("default", "chat-delete");
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("returns not_found when the synced chat store has no matching session", async () => {
    chatSessionDbMock.deleteChatSessionById.mockResolvedValueOnce(false);
    const app = await buildApp();

    const response = await request(app).delete("/api/agi/chat/sessions/local-only").expect(404);

    expect(response.body).toEqual({ error: "not_found" });
    expect(rollingContextMock.forgetHelixRollingSessionContextPacket).toHaveBeenCalledWith({
      threadId: "local-only",
      sessionId: "local-only",
    });
  });
});
