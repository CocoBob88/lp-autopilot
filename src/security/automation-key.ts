import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey() {
  const raw = process.env.AUTOPILOT_ENCRYPTION_KEY;
  if (!raw) throw new Error("AUTOPILOT_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error("AUTOPILOT_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

export function encryptAutomationKey(privateKey: `0x${string}`) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptAutomationKey(payload: string): `0x${string}` {
  const [version, iv, tag, ciphertext] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext)
    throw new Error("Unsupported encrypted automation key format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const privateKey = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey))
    throw new Error("Decrypted automation key is invalid");
  return privateKey as `0x${string}`;
}
