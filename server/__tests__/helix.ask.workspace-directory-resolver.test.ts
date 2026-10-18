import { describe, expect, it } from "vitest";
import {
  executeWorkspaceDirectoryResolveTool,
  HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY,
} from "../services/helix-ask/workspace-directory-resolver";

const workspaceRoot = process.cwd();

describe("Helix Ask workspace directory resolver", () => {
  it("resolves a generic NHM2 whitepaper query to the workspace doc path", () => {
    const result = executeWorkspaceDirectoryResolveTool({
      turnId: "ask:workspace-directory",
      callId: "call:resolve",
      query: "NHM2 theory white paper",
      workspaceRoot,
    });

    expect(result.schema).toBe("helix.workspace_directory_resolution.v1");
    expect(["resolved", "ambiguous"]).toContain(result.status);
    expect(result.selected_doc_path).toBe("docs/research/nhm2-current-status-whitepaper.md");
    expect(result.selected_uri).toBe("workspace://workspace/docs/research/nhm2-current-status-whitepaper.md");
    expect(result.assistant_answer).toBe(false);
    expect(result.terminal_eligible).toBe(false);
    expect(result.raw_content_included).toBe(false);
    expect(result.candidates[0]?.target_kind).toBe("doc");
  });

  it("accepts safe workspace URIs and rejects raw absolute paths", () => {
    const safe = executeWorkspaceDirectoryResolveTool({
      turnId: "ask:workspace-directory",
      callId: "call:safe",
      uri: "workspace://workspace/docs/research/nhm2-current-status-whitepaper.md",
      workspaceRoot,
    });
    expect(safe.status).toBe("resolved");
    expect(safe.selected_doc_path).toBe("docs/research/nhm2-current-status-whitepaper.md");

    const invalid = executeWorkspaceDirectoryResolveTool({
      turnId: "ask:workspace-directory",
      callId: "call:absolute",
      uri: "C:\\Users\\dan\\secret.md",
      workspaceRoot,
    });
    expect(invalid.status).toBe("invalid_uri");
    expect(invalid.candidates).toEqual([]);
    expect(HELIX_WORKSPACE_DIRECTORY_RESOLVE_CAPABILITY).toBe("workspace-directory.resolve");
  });

  it("preserves equation anchors in direct workspace URIs", () => {
    const result = executeWorkspaceDirectoryResolveTool({
      turnId: "ask:workspace-directory",
      callId: "call:direct-equation-uri",
      uri: "workspace://workspace/docs/research/nhm2-current-status-whitepaper.md#nhm2-wall-t00-source-residual",
      workspaceRoot,
    });

    expect(result.status).toBe("resolved");
    expect(result.selected_target_kind).toBe("doc_equation");
    expect(result.selected_anchor).toBe("nhm2-wall-t00-source-residual");
    expect(result.selected_uri).toBe(
      "workspace://workspace/docs/research/nhm2-current-status-whitepaper.md#nhm2-wall-t00-source-residual",
    );
  });

  it("resolves doc equation targets from equation action sidecars", () => {
    const result = executeWorkspaceDirectoryResolveTool({
      turnId: "ask:workspace-directory",
      callId: "call:equation",
      query: "open the scalar replay equation for wall T00 residual in the NHM2 whitepaper",
      workspaceRoot,
    });

    expect(result.status).toBe("resolved");
    expect(result.selected_target_kind).toBe("doc_equation");
    expect(result.selected_doc_path).toBe("docs/research/nhm2-current-status-whitepaper.md");
    expect(result.selected_anchor).toBe("nhm2-wall-t00-source-residual");
    expect(result.selected_artifact_kind).toBe("doc_equation_context/v1");
    expect(result.selected_uri).toBe(
      "workspace://workspace/docs/research/nhm2-current-status-whitepaper.md#nhm2-wall-t00-source-residual",
    );
    expect(result.candidates[0]).toMatchObject({
      target_kind: "doc_equation",
      equation_id: "nhm2-wall-t00-source-residual",
      artifact_id: "nhm2.closure.wall_t00_source_residual",
    });
    expect(result.searched_scopes).toContain("workspace_doc_equation_manifests");
  });
});
