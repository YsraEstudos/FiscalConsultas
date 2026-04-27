import {
  GCM_IV_SIZE,
  GCM_TAG_SIZE,
  HEADER_SIZE,
  MAGIC,
} from "./constants.js";

/** @type {string | null} */
let appSeed = null;

/**
 * @param {string | null} seed
 */
export function setAppSeed(seed) {
  appSeed = seed && seed.trim() ? seed.trim() : null;
}

function getSeed() {
  if (!appSeed) {
    throw new Error("Offline database key is missing");
  }
  return new TextEncoder().encode(appSeed);
}

/**
 * @param {Uint8Array} value
 * @returns {Promise<string>}
 */
export async function sha256Hex(value) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(hashBuffer), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * @param {Uint8Array} salt
 * @param {number} iterations
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    getSeed(),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

/**
 * @param {Uint8Array} data
 * @param {Uint8Array} expectedHmac
 * @param {Uint8Array} salt
 * @param {number} iterations
 * @returns {Promise<boolean>}
 */
async function verifyHmac(data, expectedHmac, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    getSeed(),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const hmacKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"]
  );

  return crypto.subtle.verify("HMAC", hmacKey, expectedHmac, data);
}

/**
 * @param {Uint8Array} encryptedBlob
 * @param {number} chunkSize
 * @param {number} pbkdf2Iterations
 * @returns {Promise<Uint8Array>}
 */
export async function decryptDatabase(
  encryptedBlob,
  chunkSize,
  pbkdf2Iterations
) {
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (encryptedBlob[i] !== MAGIC[i]) {
      throw new Error("Invalid file format");
    }
  }

  const version = encryptedBlob[4] | (encryptedBlob[5] << 8);
  if (version !== 1) {
    throw new Error(`Unsupported format version: ${version}`);
  }

  const salt = encryptedBlob.slice(6, 38);
  const hmacDigest = encryptedBlob.slice(38, 70);
  const key = await deriveKey(salt, pbkdf2Iterations);
  const encryptedData = encryptedBlob.slice(HEADER_SIZE);
  const plaintextChunks = [];
  let offset = 0;

  while (offset < encryptedData.length) {
    const iv = encryptedData.slice(offset, offset + GCM_IV_SIZE);
    offset += GCM_IV_SIZE;

    const remaining = encryptedData.length - offset;
    const ciphertextWithTag = encryptedData.slice(
      offset,
      offset + Math.min(remaining, chunkSize + GCM_TAG_SIZE)
    );
    offset += ciphertextWithTag.length;

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertextWithTag
    );

    plaintextChunks.push(new Uint8Array(plaintext));
  }

  const totalSize = plaintextChunks.reduce((size, chunk) => size + chunk.length, 0);
  const result = new Uint8Array(totalSize);
  let position = 0;

  for (const chunk of plaintextChunks) {
    result.set(chunk, position);
    position += chunk.length;
  }

  const hmacValid = await verifyHmac(
    result,
    hmacDigest,
    salt,
    pbkdf2Iterations
  );
  if (!hmacValid) {
    result.fill(0);
    throw new Error("Integrity verification failed");
  }

  return result;
}
