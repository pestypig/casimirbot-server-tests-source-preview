import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  WORKSPACE_ACTION_CLIENT_HANDLER_KEYS,
  WORKSPACE_ACTION_MANIFEST,
  WORKSPACE_ACTION_REGISTRY,
  WORKSPACE_ACTION_VISIBLE_PANEL_IDS,
  buildWorkspaceActionRegistryAudit,
} from "@shared/workstation-dynamic-tools";
import { planRouter } from "../routes/agi.plan";

const requiredActionKeys = [
  "docs-viewer.open",
  "docs-viewer.open_directory",
  "workstation-notes.open",
  "workstation-clipboard-history.open",
  "situation-room-sources.open",
  "situation-room-pipelines.open",
  "workstation-workflow-timeline.open",
  "workstation-task-manager.open",
  "workstation-storage-map.open",
  "agi-essence-console.open",
  "agi-task-history.open",
  "scientific-calculator.open",
];

const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/agi", planRouter);
  return app;
};

const workspaceReceiptPayload = (body: any): any => {
  const ledger = Array.isArray(body?.current_turn_artifact_ledger) ? body.current_turn_artifact_ledger : [];
  return body?.panel_action_receipt ?? ledger.find((artifact: any) => artifact?.kind === "workspace_action_receipt")?.payload ?? null;
};

describe("helix ask E67 workspace action manifest", () => {
  it("keeps visible panels, registry entries, and client handlers in sync", () => {
    const manifestKeys = WORKSPACE_ACTION_MANIFEST.filter((entry) => entry.enabled).map((entry) => entry.action_key);
    const registryKeys = WORKSPACE_ACTION_REGISTRY.filter((entry) => entry.enabled).map((entry) => entry.action_key);

    for (const key of requiredActionKeys) {
      expect(manifestKeys).toContain(key);
      expect(registryKeys).toContain(key);
      expect(WORKSPACE_ACTION_CLIENT_HANDLER_KEYS).toContain(key);
    }

    for (const panelId of WORKSPACE_ACTION_VISIBLE_PANEL_IDS) {
      expect(WORKSPACE_ACTION_MANIFEST.some((entry) => entry.enabled && entry.target_id === panelId)).toBe(true);
    }

    expect(WORKSPACE_ACTION_REGISTRY.every((entry) => entry.terminal_receipt_required === true)).toBe(true);
    expect(buildWorkspaceActionRegistryAudit().verdict).toBe("clean");
  });

  it("exposes a clean registry audit on workspace action receipts", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/agi/ask/turn")
      .send({
        question: "Open Scientific Calculator",
        mode: "read",
        debug: true,
        sessionId: `e67-manifest-${Date.now()}`,
      })
      .expect(200);

    const receipt = workspaceReceiptPayload(response.body);
    expect(receipt?.workspace_action_registry_audit?.verdict).toBe("clean");
    expect(receipt?.workspace_action_lifecycle_events?.map((event: any) => event?.event)).toEqual(
      expect.arrayContaining(["workspace_action/started", "workspace_action/dispatched"]),
    );
    expect(receipt?.workspace_action_anti_determinism_audit?.verdict).toBe("clean");
  }, 60000);
});
