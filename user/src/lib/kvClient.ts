// KV Client Factory — DEPRECATED
// Redis has been fully removed. This file is kept as a stub
// to prevent import errors from any remaining references.
// All data access now goes through src/lib/prisma.ts

// Stub: always returns true (no longer validates Redis URLs)
export function isValidUpstashUrl(_url: string): boolean {
  return true;
}
