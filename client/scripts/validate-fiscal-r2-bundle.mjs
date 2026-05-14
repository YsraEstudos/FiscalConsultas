import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { decryptDatabase, setAppSeed, sha256Hex } from '../src/workers/dbWorker/crypto.js';

const DEFAULT_BUNDLE_DIR = '../database/r2';
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\0');

function getBundleDir() {
  return resolve(process.cwd(), process.argv[2] || DEFAULT_BUNDLE_DIR);
}

function getPublicSeed() {
  const seed = (process.env.VITE_OFFLINE_DB_PUBLIC_SEED || '').trim();
  if (!seed) {
    throw new Error('VITE_OFFLINE_DB_PUBLIC_SEED must be set to validate the fiscal R2 bundle.');
  }
  return seed;
}

async function readMetadata(bundleDir) {
  const metadataPath = resolve(bundleDir, 'fiscal_offline.meta.json');
  return JSON.parse(await readFile(metadataPath, 'utf8'));
}

async function main() {
  const bundleDir = getBundleDir();
  const metadata = await readMetadata(bundleDir);
  const encryptedPath = resolve(bundleDir, 'fiscal_offline.enc');
  const encrypted = new Uint8Array(await readFile(encryptedPath));

  if (metadata.size_bytes !== encrypted.byteLength) {
    throw new Error(
      `fiscal_offline.enc size mismatch: metadata=${metadata.size_bytes}, actual=${encrypted.byteLength}.`,
    );
  }

  const actualSha256 = await sha256Hex(encrypted);
  if (actualSha256 !== metadata.encrypted_sha256) {
    throw new Error(
      `fiscal_offline.enc SHA-256 mismatch: metadata=${metadata.encrypted_sha256}, actual=${actualSha256}.`,
    );
  }

  setAppSeed(getPublicSeed());
  const plaintext = await decryptDatabase(
    encrypted,
    metadata.chunk_size || 65536,
    metadata.pbkdf2_iterations || 600000,
  );
  try {
    const hasSqliteHeader = SQLITE_HEADER.every((byte, index) => plaintext[index] === byte);
    if (!hasSqliteHeader) {
      throw new Error('Decrypted fiscal bundle is not a SQLite database.');
    }
  } finally {
    plaintext.fill(0);
  }

  console.log(`Fiscal R2 bundle decrypts successfully: ${metadata.version}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
