import { describe, expect, it, vi } from "vitest";
import {
  createAttendedFalSdkProviderFactory,
  createFalRealtimeSdkTransport,
  type FalRealtimeSdkClientLike,
} from "../fal-realtime-sdk-transport";
import type { FalFlux2KleinRealtimeTransportInput } from "../fal-flux2-klein-realtime-provider";

const request: FalFlux2KleinRealtimeTransportInput = {
  image_url: "data:image/jpeg;base64,AA==",
  prompt: "painted cave",
  seed: 35,
  num_inference_steps: 3,
  image_size: "square",
  enable_interpolation: false,
  output_feedback_strength: 1,
};

const clientFixture = () => {
  let handlers: { onResult(value: unknown): void; onError(value: unknown): void } | null = null;
  const send = vi.fn();
  const close = vi.fn();
  const connect = vi.fn((_app: string, options: typeof handlers & Record<string, unknown>) => {
    handlers = options;
    return { send, close };
  });
  return {
    client: { realtime: { connect } } as unknown as FalRealtimeSdkClientLike,
    send,
    close,
    connect,
    result: (value: unknown) => handlers!.onResult(value),
    error: () => handlers!.onError(new Error("secret provider error")),
  };
};

describe("fal realtime SDK transport boundary", () => {
  it("connects to the frozen endpoint and resolves one correlated result", async () => {
    const fixture = clientFixture();
    const transport = createFalRealtimeSdkTransport({
      client: fixture.client,
      connectionKey: "rtp:profile:session",
      requestId: () => "rtp-request-1",
    });
    const pending = transport.transform(request);
    expect(fixture.connect).toHaveBeenCalledWith(
      "fal-ai/flux-2/klein/realtime",
      expect.objectContaining({ connectionKey: "rtp:profile:session", throttleInterval: 0, maxBuffering: 1 }),
    );
    expect(fixture.send).toHaveBeenCalledWith({ ...request, request_id: "rtp-request-1" });
    fixture.result({
      request_id: "rtp-request-1", seed: 35,
      images: [{ content: "AA==", content_type: "image/jpeg", width: 768, height: 768 }],
    });
    await expect(pending).resolves.toMatchObject({ provider_request_id: "rtp-request-1", seed: 35 });
  });

  it("rejects concurrency, result rebinding, sanitized SDK errors, and post-close sends", async () => {
    const fixture = clientFixture();
    const transport = createFalRealtimeSdkTransport({ client: fixture.client, connectionKey: "rtp:test", requestId: () => "rtp-request-1" });
    const first = transport.transform(request);
    await expect(transport.transform(request)).rejects.toThrow("fal_realtime_sdk_request_in_flight");
    fixture.result({ request_id: "wrong", images: [{ content: "AA==", width: 768, height: 768 }] });
    await expect(first).rejects.toThrow("fal_realtime_sdk_request_identity_mismatch");
    const second = transport.transform(request);
    fixture.error();
    await expect(second).rejects.toThrow("fal_realtime_sdk_transport_error");
    await transport.close?.();
    expect(fixture.close).toHaveBeenCalledOnce();
    await expect(transport.transform(request)).rejects.toThrow("fal_realtime_sdk_transport_closed");
  });

  it("keeps the credential inside the server client factory", async () => {
    const fixture = clientFixture();
    const createServerClient = vi.fn(() => fixture.client);
    const factory = createAttendedFalSdkProviderFactory({
      createServerClient,
      readCredential: () => "fal-secret-value",
    });
    const provider = await factory({ profileId: "profile-a", sessionId: "session-a", onTrace: vi.fn() });
    expect(createServerClient).toHaveBeenCalledWith("fal-secret-value");
    expect(JSON.stringify(provider)).not.toContain("fal-secret-value");
    await provider.close();
  });

  it("fails closed when protected credential custody is absent", async () => {
    const factory = createAttendedFalSdkProviderFactory({
      createServerClient: vi.fn(),
      readCredential: () => undefined,
    });
    await expect(async () => factory({ profileId: "profile-a", sessionId: "session-a", onTrace: vi.fn() }))
      .rejects.toThrow("fal_realtime_credential_not_configured");
  });
});
