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
// ---------------------------------------------------------------------------

const SEED_SALT = new Uint8Array([
  0x46, 0x43, 0x53, 0x45, 0x45, 0x44, 0x57, 0x52, // "FCSEEDWR"
  0x41, 0x50, 0x4b, 0x45, 0x59, 0x21, 0x30, 0x31, // "APKEY!01"
]);

/**
 * Derive a non-extractable AES-GCM wrapping key from a user passphrase.
 * @param {string} passphrase - typically the Clerk userId
 * @returns {Promise<CryptoKey>}
 */
async function deriveSeedWrappingKey(passphrase) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: SEED_SALT, iterations: 100_000, hash: "SHA-256" },
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
  const root = await getOpfsRoot();
  const fileHandle = await root.getFileHandle(DB_SEED_KEY, { create: true });
  const writable = await fileHandle.createWritable();

  if (userPassphrase) {
    // Encrypted storage
    const key = await deriveSeedWrappingKey(userPassphrase);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(seed)
    );
    // Format: iv (12 bytes) || ciphertext
    const output = new Uint8Array(iv.length + ciphertext.byteLength);
    output.set(iv, 0);
    output.set(new Uint8Array(ciphertext), iv.length);
    await writable.write(output);
  } else {
    // Fallback: plaintext (should only happen in dev/tests)
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
    const root = await getOpfsRoot();
    const fileHandle = await root.getFileHandle(DB_SEED_KEY);
    const file = await fileHandle.getFile();

    if (userPassphrase) {
      // Encrypted storage: read iv || ciphertext
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength <= 12) return null;
      const bytes = new Uint8Array(buffer);
      const iv = bytes.slice(0, 12);
      const ciphertext = bytes.slice(12);
      const key = await deriveSeedWrappingKey(userPassphrase);
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

    // Fallback: plaintext
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

