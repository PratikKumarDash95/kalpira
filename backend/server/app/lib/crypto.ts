// AES-256-GCM encryption for researcher credentials stored in platform DB
// Each value gets a unique random IV for semantic security

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

function getEncryptionKey(): Buffer {
  const keyBase64 = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!keyBase64) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY environment variable is required in hosted mode');
  }
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 256 bits (32 bytes) base64-encoded');
  }
  return key;
}

// Encrypt a plaintext string
// Returns base64(iv + ciphertext + authTag)
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  // Pack: iv (12) + encrypted (variable) + authTag (16)
  const packed = Buffer.concat([iv, encrypted, authTag]);
  return packed.toString('base64');
}

// Decrypt a previously-encrypted value
export function decrypt(packed: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(packed, 'base64');

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(data.length - TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}
