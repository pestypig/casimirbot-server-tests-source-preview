import { expect, it } from "vitest";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";

it("restores pending and acknowledged steering in a fresh OS process without graceful database shutdown", async () => {
  const root = path.resolve(".tmp");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "steering-process-"));
  const bundle = path.join(directory, "worker.cjs"), snapshot = path.join(directory, "snapshot.json");
  try {
    await build({ entryPoints: ["server/db/__tests__/fixtures/steering-process-recovery.ts"], outfile: bundle,
      bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
    const env = { ...process.env, DATABASE_URL: "", HELIX_LOCAL_DB_PATH: snapshot,
      HELIX_LOCAL_PG_MEM_PERSIST: "1", HELIX_LOCAL_PG_MEM_WRITE_MODE: "deferred",
      HELIX_PROVIDER_CREDENTIAL_ENCRYPTION_KEY: "", HELIX_PROVIDER_CREDENTIAL_BROKER_ORIGIN: "",
      HELIX_PROVIDER_CREDENTIAL_BROKER_TOKEN: "", STEERING_PROCESS_FIXTURE_KEY: randomBytes(32).toString("base64url") };
    const run = async (mode: string) => {
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, [bundle, mode], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let output = "", terminated = false;
        const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("fixture_timeout")); }, 45000);
        child.stdout.on("data", bytes => {
          output += bytes.toString();
          if (!terminated && /^FIXTURE_RESULT:.*\n/m.test(output)) {
            terminated = child.kill("SIGKILL");
          }
        });
        child.stderr.resume();
        child.on("error", error => { clearTimeout(timer); reject(error); });
        child.on("close", () => {
          clearTimeout(timer);
          if (terminated) resolve(output); else reject(new Error("fixture_exited_before_parent_termination"));
        });
      });
      const line = stdout.split(/\r?\n/).find(line => line.startsWith("FIXTURE_RESULT:"));
      if (!line) throw new Error("fixture_result_missing");
      return JSON.parse(line.slice("FIXTURE_RESULT:".length));
    };
    const first = await run("create");
    expect(first.before).toEqual([]);
    const recovered = await run("recover");
    expect(recovered.pid).not.toBe(first.pid);
    expect(recovered.before).toEqual(first.after);
    expect(recovered.after).toEqual(first.after);
    expect(recovered.acknowledged).toEqual(first.acknowledged);
    expect(recovered.pending).toEqual(first.pending);
    expect(first.delivery.state).toBe("unknown");
    expect(recovered.delivery).toEqual(first.delivery);
    expect(first.deliveryCandidates).toEqual({ pairingIds: ["fixture-delivery-grant", "fixture-intent-grant"], nextCursor: null });
    expect(recovered.deliveryCandidates).toEqual(first.deliveryCandidates);
    expect(recovered.intentWithoutOutbox).toBeNull();
    const bytes = await readFile(snapshot, "utf8");
    expect(JSON.parse(bytes).tables.helix_durable_steering).toHaveLength(2);
    expect(JSON.parse(bytes).tables.helix_pairing_delivery).toHaveLength(1);
    expect(bytes).not.toContain('"invitationDelivery":"automatic"');
    expect(bytes).not.toContain("Private subprocess fixture instruction");
    const expired = await run("recover-expired");
    expect(expired.errors).toEqual(Array(4).fill("pairing_expired"));
    expect(expired.stored).toEqual(first.after);
    const revoked = await run("revoke");
    const recoveredRevoked = await run("recover-revoked");
    expect(new Set([first.pid, recovered.pid, expired.pid, revoked.pid, recoveredRevoked.pid]).size).toBe(5);
    expect(revoked.errors).toEqual(Array(4).fill("pairing_revoked"));
    expect(recoveredRevoked.errors).toEqual(revoked.errors);
    expect(recoveredRevoked.stored).toEqual(first.after);
    expect(JSON.parse(await readFile(snapshot, "utf8")).tables.helix_durable_steering).toHaveLength(2);
  } finally {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(root + path.sep) || !path.basename(resolved).startsWith("steering-process-")) throw new Error("fixture_cleanup_scope_invalid");
    await rm(resolved, { recursive: true, force: true });
  }
}, 120000);
