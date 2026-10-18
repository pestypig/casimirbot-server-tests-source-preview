import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routePath = join(repoRoot, "server/routes/agi.plan.ts");
const servicePath = join(repoRoot, "server/services/helix-ask/runtime/transcript-events.ts");

describe("Helix Ask transcript events extraction boundary", () => {
  it("keeps transcript event formatting implementation out of agi.plan.ts", () => {
    const routeSource = readFileSync(routePath, "utf8");
    const serviceSource = readFileSync(servicePath, "utf8");

    expect(routeSource).toContain("../services/helix-ask/runtime/transcript-events");
    expect(routeSource).toMatch(/normalizeAskTurnTranscriptSupersessionsForRuntime\(events\)\s+as\s+HelixAskTurnTranscriptEvent\[\]/);
    expect(routeSource).not.toMatch(/const\s+completeAskTurnIncrementalEvents\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildAskTurnTranscriptEvents\s*=/);
    expect(routeSource).not.toMatch(/const\s+buildAskTurnTranscriptEventsForRuntimeEvent\s*=/);
    expect(routeSource).not.toMatch(/const\s+hasMeaningfulAskTurnTranscriptRows\s*=/);
    expect(routeSource).not.toMatch(/const\s+inferHelixAskTranscriptPrompt\s*=/);
    expect(routeSource).not.toMatch(/const\s+inferHelixAskTranscriptTurnId\s*=/);
    expect(routeSource).not.toMatch(/const\s+inferHelixAskTranscriptTraceId\s*=/);
    expect(routeSource).not.toMatch(/const\s+formatAskTurnTranscriptArtifacts\s*=/);
    expect(routeSource).not.toContain("later_tool_observation_produced_doc_location_matches");
    expect(routeSource).not.toContain("later_tool_observation_produced_note_update_receipt");
    expect(serviceSource).toMatch(/export\s+const\s+buildAskTurnTranscriptEventsForRuntime\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+completeAskTurnIncrementalEvents\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildAskTurnTranscriptEvents\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+buildAskTurnTranscriptEventsForRuntimeEvent\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+hasMeaningfulAskTurnTranscriptRows\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+inferHelixAskTranscriptPrompt\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+inferHelixAskTranscriptTurnId\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+inferHelixAskTranscriptTraceId\s*=/);
    expect(serviceSource).toMatch(/export\s+const\s+normalizeAskTurnTranscriptSupersessionsForRuntime\s*=/);
    expect(serviceSource).toContain("later_tool_observation_produced_doc_location_matches");
    expect(serviceSource).not.toContain("server/routes/agi.plan");
    expect(serviceSource).not.toContain("../../../routes/agi.plan");
    expect(serviceSource).not.toContain("../../routes/agi.plan");
    expect(serviceSource).not.toContain("../routes/agi.plan");
  });
});
