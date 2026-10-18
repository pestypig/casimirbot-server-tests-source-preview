import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("Helix Ask runtime goal command boundary", () => {
  it("keeps /goal Ask routing delegated out of agi.plan.ts", () => {
    const routeSource = read("server/routes/agi.plan.ts");
    const commandRouterSource = read("server/services/helix-ask/runtime-goal-command-router.ts");
    const debugSummarySource = read("server/services/helix-ask/runtime-goal-debug-summary.ts");

    expect(routeSource).toContain(
      'import { routeHelixRuntimeGoalCommand } from "../services/helix-ask/runtime-goal-command-router";',
    );
    expect(routeSource.match(/routeHelixRuntimeGoalCommand/g) ?? []).toHaveLength(3);
    expect(routeSource).toContain('source: "helix_runtime_goal_command"');
    expect(routeSource).toContain('source: "helix_runtime_goal_command_stream"');

    expect(routeSource).not.toContain("helixRuntimeGoalSessionStore");
    expect(routeSource).not.toContain("buildRuntimeGoalDebugSummary");
    expect(routeSource).not.toContain("runtime_goal_debug_summary:");
    expect(routeSource).not.toContain("Goal is active.");
    expect(routeSource).not.toContain("No active goal session was found.");
    expect(routeSource).not.toContain("Goal wake completed");

    expect(commandRouterSource).toContain("routeHelixRuntimeGoalCommand");
    expect(commandRouterSource).toContain("helixRuntimeGoalSessionStore");
    expect(commandRouterSource).toContain("buildRuntimeGoalDebugSummary");
    expect(commandRouterSource).toContain("Goal is active.");
    expect(debugSummarySource).toContain("export const buildRuntimeGoalDebugSummary");
    expect(debugSummarySource).toContain("helix.runtime_goal.debug_copy_summary.v1");
  });
});
