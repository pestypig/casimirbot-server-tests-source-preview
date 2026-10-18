import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { startDiscordOpusProbe, type DiscordOpusDecoder, type DiscordOpusProbeResult } from "../../integrations/discord-helix-bot/src/voice-opus-probe";

const first = "1328463342570045553";
const second = "1328463342570045554";
const pcm = Buffer.alloc(3_840);

afterEach(() => vi.useRealTimers());

function decoder(decode: (packet: Buffer) => Buffer = () => pcm): DiscordOpusDecoder {
  return { decode, destroy: vi.fn() };
}

describe("bounded Discord Opus decode probe", () => {
  it("counts decoded frames and destroys every stream and decoder at its deadline", () => {
    vi.useFakeTimers();
    const streams = new Map<string, Readable>();
    const decoders = new Map<string, DiscordOpusDecoder>();
    const results: DiscordOpusProbeResult[] = [];
    startDiscordOpusProbe({
      participantIds: [first, second], durationMs: 500, maxPackets: 10,
      createDecoder: (id) => {
        const instance = decoder();
        decoders.set(id, instance);
        return instance;
      },
      subscribe: (id) => {
        const stream = new Readable({ read() {} });
        streams.set(id, stream);
        return stream;
      },
      onFinish: (result) => results.push(result),
    });
    streams.get(first)!.emit("data", Buffer.from([1, 2, 3]));
    streams.get(second)!.emit("data", Buffer.from([4, 5]));
    vi.advanceTimersByTime(500);
    expect(results).toEqual([{
      outcome: "completed", elapsedMs: 500, totalPackets: 2, totalBytes: 5,
      decodedFrames: 2, decodedBytes: 7_680,
      packetsByUser: { [first]: 1, [second]: 1 },
    }]);
    expect([...streams.values()].every((stream) => stream.destroyed)).toBe(true);
    expect([...decoders.values()].every((instance) => vi.mocked(instance.destroy).mock.calls.length === 1)).toBe(true);
  });

  it("fails closed on malformed packet, decode error, invalid PCM and packet budget", () => {
    for (const [packet, decode, outcome] of [
      [Buffer.alloc(0), () => pcm, "invalid_packet"],
      [Buffer.alloc(3_829), () => pcm, "invalid_packet"],
      [Buffer.from([1]), () => { throw new Error("bad opus"); }, "decode_error"],
      [Buffer.from([1]), () => Buffer.alloc(3), "invalid_pcm"],
      [Buffer.from([1]), () => Buffer.alloc(11_524), "invalid_pcm"],
    ] as const) {
      const stream = new Readable({ read() {} });
      const instance = decoder(decode);
      const finish = vi.fn();
      startDiscordOpusProbe({
        participantIds: [first], durationMs: 500, maxPackets: 2,
        createDecoder: () => instance, subscribe: () => stream, onFinish: finish,
      });
      stream.emit("data", packet);
      expect(finish).toHaveBeenCalledWith(expect.objectContaining({ outcome }));
      expect(stream.destroyed).toBe(true);
      if (outcome === "invalid_packet") expect(instance.destroy).not.toHaveBeenCalled();
      else expect(instance.destroy).toHaveBeenCalledOnce();
    }
    const stream = new Readable({ read() {} });
    const decode = vi.fn(() => pcm);
    const finish = vi.fn();
    startDiscordOpusProbe({
      participantIds: [first], durationMs: 500, maxPackets: 1,
      createDecoder: () => decoder(decode), subscribe: () => stream, onFinish: finish,
    });
    stream.emit("data", Buffer.from([1]));
    stream.emit("data", Buffer.from([2]));
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ outcome: "packet_budget_exceeded", decodedFrames: 1 }));
    expect(decode).toHaveBeenCalledOnce();
  });

  it("does not produce a receipt after revocation stops the probe", () => {
    vi.useFakeTimers();
    const stream = new Readable({ read() {} });
    const instance = decoder();
    const finish = vi.fn();
    const probe = startDiscordOpusProbe({
      participantIds: [first], durationMs: 500, maxPackets: 10,
      createDecoder: () => instance, subscribe: () => stream, onFinish: finish,
    });
    probe.stop();
    stream.emit("data", Buffer.from([1]));
    vi.advanceTimersByTime(1_000);
    expect(finish).not.toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
    expect(instance.destroy).not.toHaveBeenCalled();
  });

  it("rejects an incomplete or duplicate participant scope before subscribing", () => {
    const subscribe = vi.fn(() => new Readable({ read() {} }));
    const createDecoder = vi.fn(() => decoder());
    for (const participantIds of [[], [first, first], ["invalid"]]) {
      expect(() => startDiscordOpusProbe({
        participantIds, durationMs: 500, maxPackets: 10,
        createDecoder, subscribe, onFinish: () => undefined,
      })).toThrow("invalid_discord_opus_probe_scope");
    }
    expect(subscribe).not.toHaveBeenCalled();
    expect(createDecoder).not.toHaveBeenCalled();
  });

  it("does not allocate decoders if a later subscription fails", () => {
    const firstDecoder = decoder();
    const secondDecoder = decoder();
    const stream = new Readable({ read() {} });
    expect(() => startDiscordOpusProbe({
      participantIds: [first, second], durationMs: 500, maxPackets: 10,
      createDecoder: (id) => id === first ? firstDecoder : secondDecoder,
      subscribe: (id) => {
        if (id === second) throw new Error("subscription_failed");
        return stream;
      },
      onFinish: () => undefined,
    })).toThrow("subscription_failed");
    expect(stream.destroyed).toBe(true);
    expect(firstDecoder.destroy).not.toHaveBeenCalled();
    expect(secondDecoder.destroy).not.toHaveBeenCalled();
  });

  it("reports decoder initialization failure and preserves a receipt if cleanup throws", () => {
    const stream = new Readable({ read() {} });
    const finish = vi.fn();
    startDiscordOpusProbe({
      participantIds: [first], durationMs: 500, maxPackets: 10,
      createDecoder: () => { throw new Error("decoder_unavailable"); },
      subscribe: () => stream, onFinish: finish,
    });
    stream.emit("data", Buffer.from([1]));
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ outcome: "decode_error" }));

    const secondStream = new Readable({ read() {} });
    const cleanupError = decoder();
    cleanupError.destroy = () => { throw new Error("cleanup_failed"); };
    const secondFinish = vi.fn();
    startDiscordOpusProbe({
      participantIds: [first], durationMs: 500, maxPackets: 10,
      createDecoder: () => cleanupError,
      subscribe: () => secondStream, onFinish: secondFinish,
    });
    secondStream.emit("data", Buffer.from([1]));
    secondStream.emit("end");
    expect(secondFinish).toHaveBeenCalledWith(expect.objectContaining({ outcome: "stream_ended" }));
  });
});
