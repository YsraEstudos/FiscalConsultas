import {
  DB_OPFS_FILENAME,
  DB_SEED_KEY,
  DB_SOURCE_OPFS_PREFIX,
  DB_SOURCE_VERSION_PREFIX,
  DB_VERSION_KEY,
} from "./constants.js";

/**
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function getOpfsRoot() {
  return navigator.storage.getDirectory();
}

/**
 * @param {Uint8Array} data
 */
export async function saveToOpfs(data) {
  const root = await getOpfsRoot();
  const fileHandle = await root.getFileHandle(DB_OPFS_FILENAME, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

function getSourceFilename(source) {
  return `${DB_SOURCE_OPFS_PREFIX}${source}`;
}

function getSourceVersionFilename(source) {
  return `${DB_SOURCE_VERSION_PREFIX}${source}`;
}

/**
 * @param {string} source
 * @param {Uint8Array} data
 */
export async function saveSourceToOpfs(source, data) {
  const root = await getOpfsRoot();
  const fileHandle = await root.getFileHandle(getSourceFilename(source), {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

/**
 * @param {string} source
 * @returns {Promise<Uint8Array | null>}
 */
export async function readSourceFromOpfs(source) {
  try {
    const root = await getOpfsRoot();
    const fileHandle = await root.getFileHandle(getSourceFilename(source));
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<Uint8Array | null>}
 */
export async function readFromOpfs() {
  try {
    const root = await getOpfsRoot();
    const fileHandle = await root.getFileHandle(DB_OPFS_FILENAME);
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

export async function removeFromOpfs() {
  try {
    const root = await getOpfsRoot();
    await root.removeEntry(DB_OPFS_FILENAME);
  } catch {
    // File already absent.
  }

  try {
    const root = await getOpfsRoot();
    await root.removeEntry(DB_VERSION_KEY);
  } catch {
    // Version marker already absent.
  }

  try {
    const root = await getOpfsRoot();
    await root.removeEntry(DB_SEED_KEY);
  } catch {
    // Seed marker already absent.
  }
}

/**
 * @param {string} source
 */
export async function removeSourceFromOpfs(source) {
  try {
    const root = await getOpfsRoot();
    await root.removeEntry(getSourceFilename(source));
  } catch {
    // File already absent.
  }

  try {
    const root = await getOpfsRoot();
    await root.removeEntry(getSourceVersionFilename(source));
  } catch {
    // Version marker already absent.
  }
}

/**
 * @param {string} version
 */
export async function saveVersion(version) {
  const root = await getOpfsRoot();
  const fileHandle = await root.getFileHandle(DB_VERSION_KEY, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(version);
  await writable.close();
}

/**
 * @returns {Promise<string | null>}
 */
export async function readVersion() {
  try {
    const root = await getOpfsRoot();
    const fileHandle = await root.getFileHandle(DB_VERSION_KEY);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

/**
 * @param {string} source
 * @param {string} version
 */
export async function saveSourceVersion(source, version) {
  const root = await getOpfsRoot();
  const fileHandle = await root.getFileHandle(getSourceVersionFilename(source), {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(version);
  await writable.close();
}

/**
 * @param {string} source
 * @returns {Promise<string | null>}
 */
export async function readSourceVersion(source) {
  try {
    const root = await getOpfsRoot();
    const fileHandle = await root.getFileHandle(getSourceVersionFilename(source));
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Seed persistence — encrypted at rest via user-scoped AES-GCM key.
//
// The seed is the root-of-trust for offline DB decryption.  We never write it
// to OPFS in plaintext.  Instead we derive a wrapping key from a
// user-specific passphrase (userId) and encrypt the seed before storing.
//
// Threat Model:
// Protection against cross-user reads on shared devices (if one user logs out
// and another logs in, they cannot decrypt the previous user's OPFS data).
// It does not protect against a compromised origin or leaked userId.
// ---------------------------------------------------------------------------

const FORMAT_VERSION = 1;

function isDevBuild() {
  // Vite replaces import.meta.env.DEV at build time; the guards keep worker
  // tests and non-Vite runners from crashing while defaulting to production.
  return Boolean(import.meta?.env?.DEV);
}

function assertSeedPassphraseAvailable(userPassphrase) {
  if (userPassphrase || isDevBuild()) return;
  throw new Error("userPassphrase is required in production");
}

/**
 * Derive a non-extractable AES-GCM wrapping key from a user passphrase.
 * @param {string} passphrase - typically the Clerk userId
 * @param {Uint8Array} salt - random salt for PBKDF2
 * @returns {Promise<CryptoKey>}
 */
async function deriveSeedWrappingKey(passphrase, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt and persist the seed to OPFS, protected by the user passphrase.
 * @param {string} seed
 * @param {string} [userPassphrase] - user-specific binding (e.g. userId)
 */
export async function saveSeed(seed, userPassphrase) {
  assertSeedPassphraseAvailable(userPassphrase);

  const root = await getOpfsRoot();
  const fileHandle = await root.getFileHandle(DB_SEED_KEY, { create: true });
  const writable = await fileHandle.createWritable();

  if (userPassphrase) {
    // Encrypted storage
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveSeedWrappingKey(userPassphrase, salt);
    
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(seed)
    );
    // Format: Version (1 byte) || Salt (16 bytes) || IV (12 bytes) || Ciphertext
    const output = new Uint8Array(1 + salt.length + iv.length + ciphertext.byteLength);
    output[0] = FORMAT_VERSION;
    output.set(salt, 1);
    output.set(iv, 1 + salt.length);
    output.set(new Uint8Array(ciphertext), 1 + salt.length + iv.length);
    await writable.write(output);
  } else {
    // Fallback: plaintext is limited to dev/tests.
    await writable.write(seed);
  }

  await writable.close();
}

/**
 * Read and decrypt the seed from OPFS.
 * @param {string} [userPassphrase] - must match the passphrase used in saveSeed
 * @returns {Promise<string | null>}
 */
export async function readSeed(userPassphrase) {
  try {
    assertSeedPassphraseAvailable(userPassphrase);

    const root = await getOpfsRoot();
    const fileHandle = await root.getFileHandle(DB_SEED_KEY);
    const file = await fileHandle.getFile();

    if (userPassphrase) {
      // Encrypted storage: read Version || Salt || IV || Ciphertext
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength <= 29) return null; // 1 + 16 + 12
      const bytes = new Uint8Array(buffer);
      if (bytes[0] !== FORMAT_VERSION) return null;

      const salt = bytes.slice(1, 17);
      const iv = bytes.slice(17, 29);
      const ciphertext = bytes.slice(29);
      
      const key = await deriveSeedWrappingKey(userPassphrase, salt);
      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          key,
          ciphertext
        );
        const seed = new TextDecoder().decode(plaintext).trim();
        return seed || null;
      } catch {
        // Wrong passphrase or corrupted — treat as missing
        return null;
      }
    }

    // Fallback: plaintext is limited to dev/tests.
    const seed = (await file.text()).trim();
    return seed || null;
  } catch {
    return null;
  }
}

/**
 * Securely wipe the persisted seed from OPFS and clear in-memory state.
 * Call on user logout to ensure no residual key material remains.
 */
export async function wipeSeed() {
  try {
    const root = await getOpfsRoot();
    // Overwrite with zeros before deleting (defence-in-depth)
    try {
      const fileHandle = await root.getFileHandle(DB_SEED_KEY);
      const writable = await fileHandle.createWritable();
      await writable.write(new Uint8Array(64));
      await writable.close();
    } catch {
      // File may not exist
    }
    await root.removeEntry(DB_SEED_KEY);
  } catch {
    // Already absent
  }
}

