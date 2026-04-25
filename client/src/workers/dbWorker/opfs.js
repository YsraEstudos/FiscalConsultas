import { DB_OPFS_FILENAME, DB_VERSION_KEY } from "./constants.js";

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
