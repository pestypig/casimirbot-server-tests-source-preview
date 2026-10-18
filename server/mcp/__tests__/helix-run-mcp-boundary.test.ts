import path from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const forbiddenCoreDependencies = [
  /shared-live-room-control/i,
  /helix-shared-live-room-agent/i,
  /helix-room-source-ingress/i,
  /situation-room/i,
  /binding-store/i,
];

describe("Helix durable-run MCP dependency boundary", () => {
  it("does not import optional room or source-ingress implementations", async () => {
    const result = await build({
      entryPoints: [
        path.resolve(
          process.cwd(),
          "server/mcp/helix-run-mcp-server.ts",
        ),
      ],
      bundle: true,
      format: "esm",
      platform: "node",
      packages: "external",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    const inputs = Object.keys(result.metafile?.inputs ?? {}).map((entry) =>
      entry.replaceAll("\\", "/"),
    );

    for (const forbidden of forbiddenCoreDependencies) {
      expect(
        inputs.filter((entry) => forbidden.test(entry)),
        String(forbidden),
      ).toEqual([]);
    }
  });
});
