import "server-only";
import crypto from "node:crypto";

/**
 * Authenticated encryption for the few fields we must store but must never
 * store in the clear — today that is seller bank account numbers.
 *
 * AES-256-GCM: GCM authenticates the ciphertext, so tampering is detected on
 * decrypt rather than silently yielding garbage. A fresh random IV per call
 * means the same account number never produces the same ciphertext twice.
 *
 * Key: ENCRYPTION_KEY, 32 bytes, base64. Generate with
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Losing the key makes existing ciphertext unrecoverable — treat it like a
 * database credential and never rotate it without re-encrypting stored rows.
 */

const IV_BYTES = 12; // GCM standard
const TAG_BYTES = 16;

export class EncryptionNotConfiguredError extends Error {
  constructor() {
    super("ENCRYPTION_KEY is not set — refusing to store sensitive data in plaintext.");
    this.name = "EncryptionNotConfiguredError";
  }
}

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new EncryptionNotConfiguredError();
  const buffer = Buffer.from(raw, "base64");
  if (buffer.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes (base64 of 32 random bytes).");
  }
  return buffer;
}

export function isEncryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** Returns base64 of iv || ciphertext || authTag. */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64");
}

export function decrypt(payload: string): string {
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < IV_BYTES + TAG_BYTES) throw new Error("Ciphertext is too short.");

  const iv = buffer.subarray(0, IV_BYTES);
  const tag = buffer.subarray(buffer.length - TAG_BYTES);
  const ciphertext = buffer.subarray(IV_BYTES, buffer.length - TAG_BYTES);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** "••••1234" — safe to show a seller so they can recognise their own account. */
export function maskAccountNumber(accountNumber: string): string {
  const tail = accountNumber.slice(-4);
  return `${"•".repeat(Math.max(0, accountNumber.length - 4))}${tail}`;
}
