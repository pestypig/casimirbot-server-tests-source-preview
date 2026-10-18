import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HardToolBackendEntrypointRouteMetadataSchema,
  isHardCalculatorRouteMetadata,
  readHardToolBackendEntrypointRouteMetadata,
  readHardToolRouteMetadataFromSources,
  readHardToolSelectedCapability,
} from "../services/helix-ask/hard-tool-route-metadata";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/hard-tool-route-metadata.ts");

describe("Helix Ask hard-tool route metadata extraction boundary", () => {
  it("keeps hard-tool route metadata readers out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/hard-tool-route-metadata");
    expect(routeSource).not.toMatch(/const\s+readHardRouteRecord\s*=/);
    expect(routeSource).not.toMatch(/const\s+readHardRouteText\s*=/);
    expect(routeSource).not.toMatch(/const\s+readHardToolBackendEntrypointRouteMetadata\s*=/);
    expect(routeSource).not.toMatch(/const\s+readHardToolRouteMetadataFromSources\s*=/);
    expect(routeSource).not.toMatch(/const\s+readHardToolMandatoryNextTool\s*=/);
    expect(routeSource).not.toMatch(/const\s+readHardToolSelectedCapability\s*=/);
    expect(routeSource).not.toMatch(/const\s+isHardCalculatorRouteMetadata\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+HardToolBackendEntrypointRouteMetadataSchema\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readHardToolBackendEntrypointRouteMetadata\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+readHardToolRouteMetadataFromSources\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("preserves direct schema precedence for hard source-target intent with mandatory tool", () => {
    const sourceTargetIntent = {
      schema: "helix.ask_source_target_intent.v1",
      target_source: "calculator_stream",
      must_enter_backend_ask: true,
      mandatory_next_tool: {
        tool_name: "scientific-calculator.solve_expression",
      },
    };

    const parsed = readHardToolBackendEntrypointRouteMetadata(sourceTargetIntent);

    expect(parsed).toMatchObject({ mandatory_next_tool: sourceTargetIntent.mandatory_next_tool });
    expect(readHardToolSelectedCapability(parsed)).toBe("scientific-calculator.solve_expression");
    expect(isHardCalculatorRouteMetadata(parsed)).toBe(true);
  });

  it("preserves synthesized hard-tool metadata from source-target intent when direct schema does not match", () => {
    const sourceTargetIntent = {
      schema: "helix.ask_source_target_intent.v1",
      target_source: "calculator_stream",
      must_enter_backend_ask: true,
    };

    expect(readHardToolBackendEntrypointRouteMetadata(sourceTargetIntent)).toMatchObject({
      source: "hard_tool_backend_entrypoint",
      sourceTarget: "calculator_stream",
      requiredToolFamily: "calculator",
      source_target_intent: sourceTargetIntent,
    });
  });

  it("preserves direct and nested route metadata lookup precedence", () => {
    const direct = HardToolBackendEntrypointRouteMetadataSchema.parse({
      source: "hard_tool_backend_entrypoint",
      sourceTarget: "repo_code",
      requiredToolFamily: "repo_code",
      mandatory_next_tool: {
        selected_capability: "repo-code.search_concept",
      },
    });
    const nested = {
      route_metadata: {
        source: "hard_tool_backend_entrypoint",
        sourceTarget: "docs_viewer",
        requiredToolFamily: "docs_viewer",
      },
    };

    expect(readHardToolRouteMetadataFromSources(null, nested)).toMatchObject({
      sourceTarget: "docs_viewer",
      requiredToolFamily: "docs_viewer",
    });
    expect(readHardToolRouteMetadataFromSources(direct, nested)).toEqual(direct);
    expect(readHardToolSelectedCapability(direct)).toBe("repo-code.search_concept");
  });
});
