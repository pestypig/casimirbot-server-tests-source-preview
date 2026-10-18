import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startDesktopMcpTunnelTransitionBroker,
  type DesktopMcpTunnelTransitionBroker,
} from "../../apps/desktop/src/mcp-tunnel-transition-broker";

const TOKEN = "A".repeat(43);
const ACCOUNT_SESSION_ID = "account_session:12345678-abcd-4321-abcd-123456789012";

describe("desktop MCP tunnel transition broker presentation", () => {
  let broker: DesktopMcpTunnelTransitionBroker | null = null;

  afterEach(async () => {
    await broker?.close();
    broker = null;
  });

  it("admits a bounded presentation-only trust target", async () => {
    const onPresent = vi.fn(async () => ({
      presentReceiptRef: "desktop_present_receipt:12345678",
    }));
    broker = await startDesktopMcpTunnelTransitionBroker({
      token: TOKEN,
      onPresent,
      onTransition: vi.fn(),
    });

    const response = await fetch(`${broker.origin}/v1/present`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        schema: "casimir_desktop_workstation_present_request/2",
        presentationRequestRef: "desktop_tunnel_request:12345678",
        accountSessionId: ACCOUNT_SESSION_ID,
        panelId: "agent-access",
        targetId: "full-harness-trust",
      }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      accepted: true,
      presentation_only: true,
      authority_granted: false,
      credential_included: false,
    });
    expect(onPresent).toHaveBeenCalledOnce();
  });

  it("admits one catalogued-control presentation target without a target id", async () => {
    const onPresent = vi.fn(async () => ({
      presentReceiptRef: "desktop_present_receipt:catalogued-control",
    }));
    broker = await startDesktopMcpTunnelTransitionBroker({
      token: TOKEN,
      onPresent,
      onTransition: vi.fn(),
    });

    const response = await fetch(`${broker.origin}/v1/present`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        schema: "casimir_desktop_workstation_present_request/2",
        presentationRequestRef: "workstation_present_request:12345678",
        accountSessionId: ACCOUNT_SESSION_ID,
        panelId: "agent-access",
        controlId:
          "workstation.panel.agent-access.agent-connection-setup.bind-current-helix-chat",
      }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      accepted: true,
      presentation_only: true,
      authority_granted: false,
    });
    expect(onPresent).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: "agent-access",
        controlId:
          "workstation.panel.agent-access.agent-connection-setup.bind-current-helix-chat",
      }),
    );
  });

  it("admits a source-path catalogued control id without widening target ids", async () => {
    const onPresent = vi.fn(async () => ({
      presentReceiptRef: "desktop_present_receipt:source-path-control",
    }));
    broker = await startDesktopMcpTunnelTransitionBroker({
      token: TOKEN,
      onPresent,
      onTransition: vi.fn(),
    });
    const controlId =
      "workstation.panel.agent-access:client/src/components/agent-access/DurableTaskPairing.tsx:line:356:button:occurrence:0";
    const request = {
      schema: "casimir_desktop_workstation_present_request/2",
      presentationRequestRef: "workstation_present_request:source-path",
      accountSessionId: ACCOUNT_SESSION_ID,
      panelId: "agent-access",
    };
    const post = (body: object) => fetch(`${broker!.origin}/v1/present`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const presented = await post({ ...request, controlId });
    expect(presented.status).toBe(202);
    expect(await presented.json()).toMatchObject({
      accepted: true,
      presentation_only: true,
      authority_granted: false,
    });
    expect(onPresent).toHaveBeenCalledWith(expect.objectContaining({ controlId }));

    const widenedTarget = await post({ ...request, targetId: "setup/step" });
    expect(widenedTarget.status).toBe(400);
    expect(onPresent).toHaveBeenCalledOnce();
  });

  it("rejects unauthorized and widened presentation requests", async () => {
    const onPresent = vi.fn();
    broker = await startDesktopMcpTunnelTransitionBroker({
      token: TOKEN,
      onPresent,
      onTransition: vi.fn(),
    });
    const body = {
      schema: "casimir_desktop_workstation_present_request/2",
      presentationRequestRef: "desktop_tunnel_request:12345678",
      accountSessionId: ACCOUNT_SESSION_ID,
      panelId: "minecraft-control",
      targetId: "full-harness-trust",
    };

    const unauthorized = await fetch(`${broker.origin}/v1/present`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const widened = await fetch(`${broker.origin}/v1/present`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    expect(unauthorized.status).toBe(401);
    expect(widened.status).toBe(400);
    expect(onPresent).not.toHaveBeenCalled();
  });
});
