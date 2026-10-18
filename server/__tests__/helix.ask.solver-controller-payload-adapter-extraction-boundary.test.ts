import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/solver-controller-payload-adapter.ts");

describe("Helix Ask solver-controller payload adapter extraction boundary", () => {
  it("keeps the solver-controller payload adapter implementation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/solver-controller-payload-adapter");
    expect(routeSource).not.toMatch(/const\s+applySolverControllerDecisionForPayload\s*=\s*\(input:\s*\{/);
    expect(serviceSource).toMatch(/const\s+applySolverControllerDecisionForPayload\s*=\s*\(input:\s*ApplySolverControllerDecisionForPayloadInput\)/);
    expect(serviceSource).toMatch(/export\s+const\s+createSolverControllerPayloadAdapter\s*=/);
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });

  it("keeps note receipts observation-only until a current-turn terminal writer is authorized", () => {
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(serviceSource).toContain("noteReceiptHasAuthorizedTerminalWriter");
    expect(serviceSource).toContain("note_receipt_requires_runtime_terminal_writer");
    expect(serviceSource).toContain("post_tool_model_step_required: true");
    expect(serviceSource).toMatch(
      /readAskTurnString\(terminalWriterForController\?\.turn_id\) === input\.turnId/,
    );
    expect(serviceSource).toMatch(
      /readAskTurnString\(terminalAuthorityForController\?\.turn_id\) === input\.turnId/,
    );
    expect(serviceSource).toMatch(
      /terminalAuthorityForController\?\.server_authoritative === true/,
    );
  });
});
