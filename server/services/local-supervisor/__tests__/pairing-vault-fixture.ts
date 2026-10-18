import crypto from "node:crypto";
import type { PairingIdentityVault } from "../pairing-ledger-repository";
export function ephemeralPairingVault(): PairingIdentityVault {
  const key = crypto.randomBytes(32);
  return {
    async seal(value, aad) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(aad));
      const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return { keyId: "fixture-only", encryptedValue: JSON.stringify({ iv: iv.toString("hex"),
        tag: cipher.getAuthTag().toString("hex"), bytes: bytes.toString("hex") }) };
    },
    async open(envelope, aad) {
      if (envelope.keyId !== "fixture-only") throw new Error("fixture_key_mismatch");
      const data = JSON.parse(envelope.encryptedValue);
      const cipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(data.iv, "hex"));
      cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(Buffer.from(data.tag, "hex"));
      return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data.bytes, "hex")), cipher.final()]).toString());
    },
  };
}
