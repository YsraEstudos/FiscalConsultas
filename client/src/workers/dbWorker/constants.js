// Shared constants for the offline database worker runtime.

export const MAGIC = new Uint8Array([0x46, 0x43, 0x44, 0x42]); // "FCDB"
export const HEADER_SIZE = 4 + 2 + 32 + 32; // magic + version + salt + hmac
export const GCM_IV_SIZE = 12;
export const GCM_TAG_SIZE = 16;
export const DB_OPFS_FILENAME = "fiscal_offline.enc";
export const DB_VERSION_KEY = "fiscal_offline_version";
export const MULTI_CODE_MAX_PARTS = 25;
export const MAX_ANCESTOR_DEPTH = 64;

// This seed MUST match the backend build_offline_db.py APP_SEED.
export const APP_SEED_BYTES = [
  102, 105, 115, 99, 97, 108, 45, 99, 111, 110, 115, 117, 108, 116, 97, 115,
  45, 111, 102, 102, 108, 105, 110, 101, 45, 50, 48, 50, 54,
];
