// Shared constants for the offline database worker runtime.

export const MAGIC = new Uint8Array([0x46, 0x43, 0x44, 0x42]); // "FCDB"
export const HEADER_SIZE = 4 + 2 + 32 + 32; // magic + version + salt + hmac
export const GCM_IV_SIZE = 12;
export const GCM_TAG_SIZE = 16;
export const DB_OPFS_FILENAME = "fiscal_offline.enc";
export const DB_VERSION_KEY = "fiscal_offline_version";
// TODO(security): saveSeed/readSeed persist plaintext seed under DB_SEED_KEY.
// Replace with platform-backed or non-extractable key wrapping when available.
export const DB_SEED_KEY = "fiscal_offline_seed";
export const MULTI_CODE_MAX_PARTS = 25;
export const MAX_ANCESTOR_DEPTH = 64;
export const TOKEN_REFRESH_TIMEOUT_MS = 30000;
