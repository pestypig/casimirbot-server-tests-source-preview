import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildRealtimeTexturePackConfig,
  buildRealtimeTexturePackTransformRequest,
} from "@shared/realtime-texture-pack";
import {
  createFalFlux2KleinRealtimeProvider,
  type FalFlux2KleinRealtimeTrace,
  type FalFlux2KleinRealtimeTransport,
} from "../fal-flux2-klein-realtime-provider";

let sourceDataUrl = "";
let squareJpeg = new Uint8Array();

beforeAll(async () => {
  const source = await sharp({
    create: { width: 512, height: 288, channels: 3, background: { r: 12, g: 80, b: 140 } },
  }).jpeg().toBuffer();
  sourceDataUrl = `data:image/jpeg;base64,${source.toString("base64")}`;
  squareJpeg = await sharp({
    create: { width: 768, height: 768, channels: 3, background: { r: 160, g: 70, b: 20 } },
  }).jpeg().toBuffer();
});

const request = () => buildRealtimeTexturePackTransformRequest({
  config: buildRealtimeTexturePackConfig({
    sessionId: "texture-session:fal-test",
    sourceId: "texture-source:fal-test",
    sourceSurface: "window",
    providerId: "fal_flux2_klein_realtime",
  }),
  requestId: "texture-request:fal-test:1",
  sourceFrameId: "source-frame:fal-test:1",
  sourceCapturedAt: "2026-08-27T20:00:00.000Z",
  sourceImageDataUrl: sourceDataUrl,
});

describe("fal FLUX.2 Klein realtime RTP provider", () => {
  it("letterboxes to 704 square, seals provider options, crops to 512x288, and preserves identity", async () => {
    const traces: FalFlux2KleinRealtimeTrace[] = [];
    const transport: FalFlux2KleinRealtimeTransport = {
      transform: vi.fn(async (input) => {
        const encoded = Buffer.from(input.image_url.split(",")[1], "base64");
        const metadata = await sharp(encoded).metadata();
        expect(metadata).toMatchObject({ format: "jpeg", width: 704, height: 704 });
        expect(input).toMatchObject({
          seed: 35,
          num_inference_steps: 3,
          image_size: "square",
          enable_interpolation: false,
          output_feedback_strength: 1,
        });
        return {
          images: [{ content: squareJpeg, content_type: "image/jpeg", width: 768, height: 768 }],
          provider_request_id: "fal-request:test",
        };
      }),
    };
    const provider = createFalFlux2KleinRealtimeProvider({
      transport,
      completedAt: () => "2026-08-27T20:00:00.500Z",
      now: (() => { let tick = 1_000; return () => (tick += 50); })(),
      onTrace: (trace) => traces.push(trace),
    });
    const input = request();
    const frame = await provider.transform(input);

    expect(frame).toMatchObject({
      request_id: input.request_id,
      session_id: input.session_id,
      source_frame_id: input.source_frame_id,
      provider_id: "fal_flux2_klein_realtime",
      provider_model: "fal-ai/flux-2/klein/realtime",
      authoritative: false,
      interpolated: false,
    });
    const projection = Buffer.from(frame.projection_image_data_url.split(",")[1], "base64");
    await expect(sharp(projection).metadata()).resolves.toMatchObject({ width: 512, height: 288 });
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      status: "completed",
      provider_request_id: "fal-request:test",
      prompt_included: false,
      pixels_included: false,
      credential_included: false,
      authoritative: false,
    });
    expect(JSON.stringify(traces[0])).not.toContain(input.prompt);
    expect(JSON.stringify(traces[0])).not.toContain("base64");
  });

  it.each([
    [{ content: squareJpeg, content_type: "image/png", width: 768, height: 768 }, "fal_realtime_output_jpeg_required"],
    [{ content: squareJpeg, content_type: "image/jpeg", width: 768, height: 512 }, "fal_realtime_output_dimensions_unsupported"],
    [{ content: "not base64!", content_type: "image/jpeg", width: 768, height: 768 }, "fal_realtime_output_content_invalid"],
  ])("fails closed for malformed provider output", async (image, error) => {
    const provider = createFalFlux2KleinRealtimeProvider({
      transport: { transform: async () => ({ images: [image] }) },
    });
    await expect(provider.transform(request())).rejects.toThrow(error);
  });

  it("closes the injected realtime transport", async () => {
    const close = vi.fn(async () => undefined);
    const provider = createFalFlux2KleinRealtimeProvider({
      transport: { transform: async () => ({ images: [] }), close },
    });
    await provider.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
