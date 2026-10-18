import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createHudSurfaceRouter } from "../hud-surfaces";
import { SurfaceRegistryService } from "../../services/hud-surface/surface-registry-service";

const sameOrigin = { Host: "localhost", Origin: "http://localhost", "Sec-Fetch-Site": "same-origin" };
const desired = {
  profile_id: "motorcycle-awareness", run_id: "fixture:rear", source: { source_id: "fixture", producer_epoch: "epoch-1", source_kind: "simulator" as const },
  composition_mode: "hud_over_source" as const, transform_ref: "normalized-unit-rect-v1", output_target: "workstation_preview" as const,
};
const session = (accountType: "developer" | "user", profile = "profile:developer") => ({ subject_id: "subject", profile: { profile_id: profile }, account_policy: { account_type: accountType } }) as any;
const appFor = (accountType: "developer" | "user", profile = "profile:developer") => {
  const service = new SurfaceRegistryService(() => new Date("2026-09-04T17:00:00.000Z"));
  const app = express(); app.use(express.json());
  app.use("/api/hud-surfaces", createHudSurfaceRouter({ service, getSession: async () => session(accountType, profile) }));
  return { app, service };
};

describe("developer shared Surface Registry route", () => {
  it("keeps the registry unavailable to public user sessions", async () => {
    const { app } = appFor("user");
    const response = await request(app).get("/api/hud-surfaces");
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("developer_account_required");
  });

  it("creates, lists, revision-configures, and grants a bounded user-issued lease", async () => {
    const { app } = appFor("developer");
    const created = await request(app).post("/api/hud-surfaces").set(sameOrigin).send({ surface_instance_id: "surface-route", desired_state: desired });
    expect(created.status).toBe(201);
    expect(created.body.surface).toMatchObject({ revision: 1, status: "active", model_answer_authority: false });
    const listed = await request(app).get("/api/hud-surfaces");
    expect(listed.body.surfaces).toHaveLength(1);
    const configured = await request(app).post("/api/hud-surfaces/surface-route/commands").set(sameOrigin).send({ operation: "configure", expected_revision: 1, desired_state: { ...desired, composition_mode: "hud_only_alpha" } });
    expect(configured.body.surface).toMatchObject({ revision: 2, desired_state: { composition_mode: "hud_only_alpha" } });
    const leased = await request(app).post("/api/hud-surfaces/surface-route/control-leases").set(sameOrigin).send({ thread_id: "thread-1", permitted_operations: ["configure", "blank"], duration_ms: 60_000 });
    expect(leased.status).toBe(201);
    expect(leased.body.lease).toMatchObject({ thread_id: "thread-1", bound_source_id: "fixture", status: "active" });
  });

  it("rejects cross-origin writes", async () => {
    const { app } = appFor("developer");
    const response = await request(app).post("/api/hud-surfaces").set({ Host: "localhost", Origin: "https://outside.example", "Sec-Fetch-Site": "cross-site" }).send({ desired_state: desired });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("cross_origin_forbidden");
  });

  it("prepares a typed human panel route carrying the exact canonical identity", async () => {
    const { app } = appFor("developer");
    await request(app).post("/api/hud-surfaces").set(sameOrigin).send({ surface_instance_id: "surface-route", desired_state: desired });
    const response = await request(app).post("/api/hud-surfaces/surface-route/panel-routes").set(sameOrigin).send({
      schema: "helix.surface_panel_route.v1", expected_revision: 1, target: "hud_lab",
      sequence_id: "frame-3", requested_view: "surface-context", focus_target: "rear-left",
    });
    expect(response.status).toBe(201);
    expect(response.body.route).toMatchObject({
      target_panel_id: "motorcycle-hud-lab",
      surface_revision: 1,
      assistant_answer: false,
      terminal_eligible: false,
      context: { source_id: "fixture", producer_epoch: "epoch-1", sequence_id: "frame-3" },
    });
    const inspected = await request(app).get("/api/hud-surfaces/surface-route");
    expect(inspected.body.route_receipts).toHaveLength(1);
    expect(inspected.body.surface.revision).toBe(1);
  });
});
