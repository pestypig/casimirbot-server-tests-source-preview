import crypto from "node:crypto";
import { helixWorkspaceRefFor } from "../local-supervisor-identity";

export const signedLauncherEnvironment = (
  workspacePath: string,
  now = new Date("2026-08-27T18:00:00.000Z"),
): NodeJS.ProcessEnv => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const payload = Buffer.from(JSON.stringify({
    schema: "helix.local_supervisor_ownership_receipt.v1",
    workspace_ref: helixWorkspaceRefFor(workspacePath),
    boot_nonce: "launcher_boot_nonce_1234567890",
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    supervisor_mode: "external_keyed_launcher",
  }), "utf8");
  return {
    CASIMIR_LOCAL_SUPERVISOR_OWNERSHIP_RECEIPT: Buffer.from(JSON.stringify({
      payload: payload.toString("base64url"),
      signature: crypto.sign(null, payload, privateKey).toString("base64url"),
    }), "utf8").toString("base64url"),
    CASIMIR_LOCAL_SUPERVISOR_TRUSTED_PUBLIC_KEYS_SPKI_B64URL: publicKey.export({
      type: "spki",
      format: "der",
    }).toString("base64url"),
  };
};
