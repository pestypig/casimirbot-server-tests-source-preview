import { describe, expect, it } from "vitest";
import type { SurfaceDesiredState, SurfacePrincipal } from "@shared/helix-surface-registry";
import { SurfaceRegistryError, SurfaceRegistryService } from "../surface-registry-service";

const desired: SurfaceDesiredState = {
  profile_id: "motorcycle-awareness",
  run_id: "fixture:rear-closing",
  source: { source_id: "fivem:rear-radar", producer_epoch: "epoch-1", source_kind: "simulator" },
  composition_mode: "hud_over_source",
  transform_ref: "normalized-unit-rect-v1",
  output_target: "workstation_preview",
};
const ui = (owner: string): SurfacePrincipal => ({ kind: "human_ui", principal_id: "developer-user", owner_profile_id: owner, thread_id: null, control_lease_id: null });

describe("shared Surface Registry state authority", () => {
  it("produces identical canonical hashes for UI and leased MCP clients", () => {
    const at = () => new Date("2026-09-04T16:00:00.000Z");
    const uiService = new SurfaceRegistryService(at);
    const mcpService = new SurfaceRegistryService(at);
    const owner = "profile:developer";
    const uiCreated = uiService.create(owner, desired, "surface-ui").surface;
    const mcpCreated = mcpService.create(owner, desired, "surface-mcp").surface;
    expect(uiCreated.state_hash).toBe(mcpCreated.state_hash);

    const next = { ...desired, composition_mode: "hud_only_alpha" as const, output_target: "clean_feed" as const };
    const uiResult = uiService.execute(owner, "surface-ui", { operation: "configure", expected_revision: 1, desired_state: next }, ui(owner));
    const lease = mcpService.issueControlLease(owner, "surface-mcp", "thread-1", ["configure"], 60_000).lease;
    const mcpResult = mcpService.execute(owner, "surface-mcp", { operation: "configure", expected_revision: 1, desired_state: next }, {
      kind: "mcp_codex", principal_id: "mcp-client", owner_profile_id: owner, thread_id: "thread-1", control_lease_id: lease.control_lease_id,
    });
    expect(mcpResult.surface.state_hash).toBe(uiResult.surface.state_hash);
    expect(mcpResult.receipt.principal.principal_id).not.toBe(uiResult.receipt.principal.principal_id);
    expect(mcpResult.receipt.assistant_answer).toBe(false);
    expect(mcpResult.surface).toMatchObject({ program_input_authority: false, reflex_authority: false, model_answer_authority: false });
  });

  it("fails stale revisions and cross-profile inspection without leaking state", () => {
    const service = new SurfaceRegistryService();
    service.create("owner-a", desired, "surface-a");
    expect(() => service.execute("owner-a", "surface-a", { operation: "blank", expected_revision: 2, reason: "emergency_blank" }, ui("owner-a"))).toThrowError(SurfaceRegistryError);
    try { service.inspect("owner-b", "surface-a"); } catch (error) {
      expect(error).toMatchObject({ status: 404, code: "surface_not_found" });
    }
  });

  it("binds MCP control to exact thread, operation, profile, source, and producer epoch", () => {
    const service = new SurfaceRegistryService();
    service.create("owner", desired, "surface");
    const lease = service.issueControlLease("owner", "surface", "thread-1", ["configure"], 60_000).lease;
    const principal: SurfacePrincipal = { kind: "mcp_codex", principal_id: "codex", owner_profile_id: "owner", thread_id: "thread-1", control_lease_id: lease.control_lease_id };
    expect(() => service.execute("owner", "surface", { operation: "configure", expected_revision: 1, desired_state: { ...desired, source: { ...desired.source, producer_epoch: "epoch-2" } } }, principal)).toThrowError(expect.objectContaining({ code: "source_identity_mismatch" }));
    expect(() => service.execute("owner", "surface", { operation: "blank", expected_revision: 1, reason: "emergency_blank" }, principal)).toThrowError(expect.objectContaining({ code: "control_lease_invalid" }));
  });

  it("releases output and control leases on Emergency Blank, source rotation, and sign-out", () => {
    const service = new SurfaceRegistryService();
    service.create("owner", desired, "blanked");
    const blankLease = service.issueControlLease("owner", "blanked", "thread", ["blank"], 60_000).lease;
    const blanked = service.execute("owner", "blanked", { operation: "blank", expected_revision: 1, reason: "emergency_blank" }, { kind: "mcp_codex", principal_id: "codex", owner_profile_id: "owner", thread_id: "thread", control_lease_id: blankLease.control_lease_id }).surface;
    expect(blanked).toMatchObject({ status: "blanked", output_lease: { status: "released", release_reason: "emergency_blank" } });

    service.create("owner", desired, "rotated");
    expect(service.rotateSource("owner", desired.source.source_id, desired.source.producer_epoch).map(({ surface }) => surface.status)).toContain("blanked");
    service.create("owner", { ...desired, source: { ...desired.source, source_id: "other" } }, "signed-out");
    const signedOut = service.signOut("owner");
    expect(signedOut.every(({ surface }) => surface.status === "released" && surface.output_lease?.release_reason === "sign_out")).toBe(true);
  });

  it("rejects stale PanelLaunchContext identities", () => {
    const service = new SurfaceRegistryService();
    service.create("owner", desired, "surface");
    expect(() => service.validateLaunchContext("owner", { surface_instance_id: "surface", surface_revision: 1, profile_id: desired.profile_id, source_id: desired.source.source_id, producer_epoch: "wrong" })).toThrowError(expect.objectContaining({ code: "source_identity_mismatch" }));
  });

  it("prepares an exact non-terminal panel route without mutating surface state", () => {
    const service = new SurfaceRegistryService(() => new Date("2026-09-04T19:00:00.000Z"));
    const created = service.create("owner", desired, "surface-route").surface;
    const result = service.preparePanelRoute("owner", "surface-route", {
      schema: "helix.surface_panel_route.v1",
      expected_revision: 1,
      target: "hud_lab",
      sequence_id: "sequence-4",
      requested_view: "surface-context",
      focus_target: "rear-left",
    }, ui("owner"));

    expect(result.surface).toEqual(created);
    expect(result.route).toMatchObject({
      surface_revision: 1,
      target_panel_id: "motorcycle-hud-lab",
      assistant_answer: false,
      terminal_eligible: false,
      context: {
        surface_instance_id: "surface-route",
        source_id: desired.source.source_id,
        producer_epoch: desired.source.producer_epoch,
        sequence_id: "sequence-4",
      },
    });
    expect(service.inspect("owner", "surface-route")).toMatchObject({
      surface: { revision: 1, state_hash: created.state_hash },
      route_receipts: [{ route_id: result.route.route_id }],
    });
    expect(() => service.preparePanelRoute("owner", "surface-route", {
      schema: "helix.surface_panel_route.v1", expected_revision: 2, target: "image_lens",
      sequence_id: null, requested_view: null, focus_target: null,
    }, ui("owner"))).toThrowError(expect.objectContaining({ code: "surface_conflict" }));
  });

  it("requires an exact route operation lease for MCP panel routes", () => {
    const service = new SurfaceRegistryService();
    service.create("owner", desired, "surface-route");
    const configureLease = service.issueControlLease("owner", "surface-route", "thread-1", ["configure"], 60_000).lease;
    const request = {
      schema: "helix.surface_panel_route.v1" as const, expected_revision: 1, target: "image_lens" as const,
      sequence_id: null, requested_view: null, focus_target: null,
    };
    expect(() => service.preparePanelRoute("owner", "surface-route", request, {
      kind: "mcp_codex", principal_id: "codex", owner_profile_id: "owner", thread_id: "thread-1", control_lease_id: configureLease.control_lease_id,
    })).toThrowError(expect.objectContaining({ code: "control_lease_invalid" }));

    const routeLease = service.issueControlLease("owner", "surface-route", "thread-1", ["route"], 60_000).lease;
    expect(service.preparePanelRoute("owner", "surface-route", request, {
      kind: "mcp_codex", principal_id: "codex", owner_profile_id: "owner", thread_id: "thread-1", control_lease_id: routeLease.control_lease_id,
    }).route).toMatchObject({ target_panel_id: "image-lens", principal: { kind: "mcp_codex" } });
  });
});
