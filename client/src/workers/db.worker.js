/**
 * Offline Database Web Worker
 *
 * This Worker encapsulates ALL SQLite WASM operations and cryptographic
 * operations. The decrypted database NEVER leaves this Worker context.
 *
 * Security layers:
 * 1. AES-256-GCM decryption (Web Crypto API)
 * 2. PBKDF2 key derivation with domain binding
 * 3. HMAC-SHA256 integrity verification
 * 4. Decrypt-to-memory-only (WASM heap)
 * 5. Encrypted-at-rest local storage (OPFS)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAGIC = new Uint8Array([0x46, 0x43, 0x44, 0x42]); // "FCDB"
const HEADER_SIZE = 4 + 2 + 32 + 32; // magic(4) + version(2) + salt(32) + hmac(32)
const GCM_IV_SIZE = 12;
const GCM_TAG_SIZE = 16;
const DB_OPFS_FILENAME = "fiscal_offline.enc";
const DB_VERSION_KEY = "fiscal_offline_version";
const MULTI_CODE_MAX_PARTS = 25;
const MAX_ANCESTOR_DEPTH = 64;
const SEARCH_CACHE_MAX = 32;

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
  isCodeQuery,
  cleanNcm,
  formatNcmTipi,
  extractChapterFromNcm,
  splitNcmQuery,
  buildAncestorPrefixes,
  buildTipiHierarchy,
  buildNeshChapterResult,
  preferMoreSpecific,
} from "./workerUtils.js";

// This seed MUST match the backend build_offline_db.py APP_SEED
const _s = [
  102, 105, 115, 99, 97, 108, 45, 99, 111, 110, 115, 117, 108, 116, 97, 115,
  45, 111, 102, 102, 108, 105, 110, 101, 45, 50, 48, 50, 54,
]; // encoded app seed

/** @type {any} */
let _db = null;
/** @type {string | null} */
let _currentVersion = null;
/** @type {'not_installed' | 'ready' | 'installing' | 'error' | 'checking'} */
let _status = "checking";

// ---------------------------------------------------------------------------
// LRU Search Cache — avoids re-executing identical queries
// ---------------------------------------------------------------------------
/** @type {Map<string, {results: any, searchType: string}>} */
const _searchCache = new Map();

function _getCacheKey(docType, query, viewMode) {
  return `${docType}\0${query}\0${viewMode || ''}`;
}

function _getCachedResult(key) {
  if (!_searchCache.has(key)) return null;
  const value = _searchCache.get(key);
  // Move to end (MRU position)
  _searchCache.delete(key);
  _searchCache.set(key, value);
  return value;
}

function _setCachedResult(key, value) {
  if (_searchCache.size >= SEARCH_CACHE_MAX) {
    // Evict oldest (first key in Map iteration order)
    const oldest = _searchCache.keys().next().value;
    _searchCache.delete(oldest);
  }
  _searchCache.set(key, value);
}

function _clearSearchCache() {
  _searchCache.clear();
}

// ---------------------------------------------------------------------------
// Logging controls (avoid noisy worker logs in production builds)
// ---------------------------------------------------------------------------
const _c = self.console;
// In production, suppress worker console to reduce info leakage
if (
  typeof self.location !== "undefined" &&
  !self.location.href.includes("localhost")
) {
  self.console = /** @type {Console} */ ({
    log: () => {},
    warn: () => {},
    error: _c.error.bind(_c),
    info: () => {},
    debug: () => {},
    dir: () => {},
    table: () => {},
    trace: () => {},
    assert: () => {},
    clear: () => {},
    count: () => {},
    countReset: () => {},
    group: () => {},
    groupEnd: () => {},
    groupCollapsed: () => {},
    time: () => {},
    timeEnd: () => {},
    timeLog: () => {},
    timeStamp: () => {},
  });
}

// ---------------------------------------------------------------------------
// Crypto utilities (Web Crypto API)
// ---------------------------------------------------------------------------

function _getSeed() {
  return new TextEncoder().encode(String.fromCharCode(..._s));
}

/**
 * @param {Uint8Array} value
 * @returns {Promise<string>}
 */
async function sha256Hex(value) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(hashBuffer), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Derive AES-256 key using PBKDF2 with domain binding.
 * @param {Uint8Array} salt
 * @param {number} iterations
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(salt, iterations) {
  const seed = _getSeed();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    seed,
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
    false, // not extractable
    ["decrypt"]
  );
}

/**
 * Verify HMAC-SHA256 integrity.
 * @param {Uint8Array} data
 * @param {Uint8Array} expectedHmac
 * @param {Uint8Array} salt
 * @param {number} iterations
 * @returns {Promise<boolean>}
 */
async function verifyHmac(data, expectedHmac, salt, iterations) {
  const seed = _getSeed();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    seed,
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
 * Decrypt AES-256-GCM encrypted chunks.
 * @param {Uint8Array} encryptedBlob - Full encrypted file including header
 * @param {number} chunkSize - Plaintext chunk size (default 64KB)
 * @param {number} pbkdf2Iterations
 * @returns {Promise<Uint8Array>} Decrypted plaintext
 */
async function decryptDatabase(encryptedBlob, chunkSize, pbkdf2Iterations) {
  // Validate magic
  for (let i = 0; i < MAGIC.length; i++) {
    if (encryptedBlob[i] !== MAGIC[i]) {
      throw new Error("Invalid file format");
    }
  }

  // Parse header
  const version =
    encryptedBlob[4] | (encryptedBlob[5] << 8);
  if (version !== 1) {
    throw new Error(`Unsupported format version: ${version}`);
  }

  const salt = encryptedBlob.slice(6, 38);
  const hmacDigest = encryptedBlob.slice(38, 70);

  // Derive key
  const key = await deriveKey(salt, pbkdf2Iterations);

  // Decrypt chunks
  const encryptedData = encryptedBlob.slice(HEADER_SIZE);
  const plaintextChunks = [];
  let offset = 0;

  while (offset < encryptedData.length) {
    const iv = encryptedData.slice(offset, offset + GCM_IV_SIZE);
    offset += GCM_IV_SIZE;

    // Remaining bytes for this chunk (ciphertext + GCM tag)
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

  // Reassemble
  const totalSize = plaintextChunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const chunk of plaintextChunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }

  // Verify HMAC
  const hmacValid = await verifyHmac(result, hmacDigest, salt, pbkdf2Iterations);
  if (!hmacValid) {
    // Zero out decrypted data on failure
    result.fill(0);
    throw new Error("Integrity verification failed");
  }

  return result;
}

// ---------------------------------------------------------------------------
// OPFS helpers
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function getOpfsRoot() {
  return navigator.storage.getDirectory();
}

/**
 * @param {Uint8Array} data
 */
async function saveToOpfs(data) {
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
async function readFromOpfs() {
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

async function removeFromOpfs() {
  try {
    const root = await getOpfsRoot();
    await root.removeEntry(DB_OPFS_FILENAME);
  } catch {
    // File doesn't exist, that's fine
  }
  // Also remove version from localStorage if available
  // (Worker doesn't have localStorage, use a flag in OPFS instead)
  try {
    const root = await getOpfsRoot();
    await root.removeEntry(DB_VERSION_KEY);
  } catch {
    // OK
  }
}

/**
 * @param {string} version
 */
async function saveVersion(version) {
  const root = await getOpfsRoot();
  const fileHandle = await root.getFileHandle(DB_VERSION_KEY, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(version);
  await writable.close();
}

/**
 * @returns {Promise<string | null>}
 */
async function readVersion() {
  try {
    const root = await getOpfsRoot();
    const fileHandle = await root.getFileHandle(DB_VERSION_KEY);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SQLite WASM initialization
// ---------------------------------------------------------------------------

/** @type {any} */
let sqlite3Api = null;

async function initSqlite() {
  if (sqlite3Api) return sqlite3Api;

  sqlite3Api = await sqlite3InitModule({
    print: () => {},
    printErr: () => {},
  });

  return sqlite3Api;
}

/**
 * Load decrypted bytes into an in-memory SQLite database.
 * @param {Uint8Array} dbBytes
 */
async function loadDatabaseFromBytes(dbBytes) {
  const sqlite3 = await initSqlite();
  const oo = sqlite3.oo1;

  // Close existing DB if any
  if (_db) {
    try {
      _db.close();
    } catch {
      /* ignore */
    }
    _db = null;
  }

  // Create in-memory DB and deserialize
  _db = new oo.DB(":memory:");

  // Use the C API to deserialize the bytes into the in-memory DB
  const pDb = _db.pointer;
  if (!pDb) throw new Error("Failed to get DB pointer");

  const rc = sqlite3.capi.sqlite3_deserialize(
    pDb,
    "main",
    sqlite3.wasm.allocFromTypedArray(dbBytes),
    dbBytes.length,
    dbBytes.length,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
      sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
  );

  if (rc !== 0) {
    throw new Error(`sqlite3_deserialize failed with code ${rc}`);
  }

  // Read-optimized PRAGMAs for in-memory DB
  _db.exec("PRAGMA cache_size = -4000");   // 4 MB page cache
  _db.exec("PRAGMA temp_store = MEMORY");   // temp tables in WASM heap

  // Verify DB is usable
  const testResult = _db.exec("SELECT value FROM db_metadata WHERE key='version'", {
    returnValue: "resultRows",
  });
  if (testResult && testResult.length > 0) {
    _currentVersion = testResult[0][0];
  }

  // Invalidate search cache when a new DB is loaded
  _clearSearchCache();
}

// ---------------------------------------------------------------------------
// Search functions
// ---------------------------------------------------------------------------

/**
 * Execute a FTS5 search query.
 * @param {string} table - FTS table name
 * @param {string} query - Search query
 * @param {string[]} columns - Columns to return from the content table
 * @param {string} contentTable - Content table name
 * @param {number} limit
 * @returns {Array<Record<string, any>>}
 */
function ftsSearch(table, query, columns, contentTable, limit = 50) {
  if (!_db) return [];

  // Sanitize query for FTS5 - escape special characters
  const sanitized = query
    .replace(/["\\']/, "")
    .replace(/[{}()[\]^~*?:!]/g, " ")
    .trim();

  if (!sanitized) return [];

  // Build FTS5 match expression with prefix matching
  const terms = sanitized.split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return [];

  const matchExpr = terms.map((t) => `"${t}"*`).join(" ");
  const colList = columns.map((c) => `ct.${c}`).join(", ");

  try {
    // Optimized: JOIN instead of IN(subquery) — lets SQLite use FTS index directly
    const sql = `
      SELECT ${colList}
      FROM ${table} AS ft
      JOIN ${contentTable} AS ct ON ct.rowid = ft.rowid
      WHERE ft MATCH ?
      ORDER BY ft.rank
      LIMIT ?
    `;
    const rows = _db.exec(sql, {
      bind: [matchExpr, limit],
      returnValue: "resultRows",
      rowMode: "object",
    });
    return rows || [];
  } catch {
    // Fallback: try LIKE search
    try {
      const likeClause = terms
        .map(() => `${columns.slice(-1)[0]} LIKE ?`)
        .join(" AND ");
      const likeParams = terms.map((t) => `%${t}%`);
      const fallbackColList = columns.join(", ");
      const sql = `SELECT ${fallbackColList} FROM ${contentTable} WHERE ${likeClause} LIMIT ?`;
      const rows = _db.exec(sql, {
        bind: [...likeParams, limit],
        returnValue: "resultRows",
        rowMode: "object",
      });
      return rows || [];
    } catch {
      return [];
    }
  }
}

/**
 * @param {string} query
 * @returns {Array<Record<string, any>>}
 */
function searchNbs(query) {
  return ftsSearch(
    "nbs_fts",
    query,
    ["code", "code_clean", "description", "parent_code", "level", "has_nebs"],
    "nbs_items"
  );
}

/**
 * @param {string} query
 * @returns {Array<Record<string, any>>}
 */
function searchNebs(query) {
  return ftsSearch(
    "nebs_fts",
    query,
    ["code", "code_clean", "title", "body_text", "section_title"],
    "nebs_entries"
  );
}

/**
 * Search NBS by structured service code, preferring exact matches and then descendants.
 * @param {string} query
 * @param {number} limit
 * @returns {Array<Record<string, any>>}
 */
function searchNbsByCode(query, limit = 50) {
  if (!_db) return [];

  const rawQuery = String(query || "").trim();
  const cleanQuery = cleanServiceCode(rawQuery);
  if (!rawQuery && !cleanQuery) return [];

  return fetchAll(
    `SELECT
        code,
        code_clean,
        description,
        parent_code,
        level,
        has_nebs
     FROM nbs_items
     WHERE (? <> '' AND (code = ? OR code LIKE ?))
        OR (? <> '' AND (code_clean = ? OR code_clean LIKE ?))
     ORDER BY
        CASE
          WHEN code = ? OR code_clean = ? THEN 0
          WHEN code LIKE ? OR code_clean LIKE ? THEN 1
          ELSE 2
        END,
        level ASC,
        source_order ASC,
        LENGTH(code_clean) ASC
     LIMIT ?`,
    [
      rawQuery,
      rawQuery,
      `${rawQuery}%`,
      cleanQuery,
      cleanQuery,
      `${cleanQuery}%`,
      rawQuery,
      cleanQuery,
      `${rawQuery}%`,
      `${cleanQuery}%`,
      limit,
    ]
  ).map(rowToNbsItem);
}

/**
 * Search NEBS by structured service code, preferring exact matches and then descendants.
 * @param {string} query
 * @param {number} limit
 * @returns {Array<Record<string, any>>}
 */
function searchNebsByCode(query, limit = 50) {
  if (!_db) return [];

  const rawQuery = String(query || "").trim();
  const cleanQuery = cleanServiceCode(rawQuery);
  if (!rawQuery && !cleanQuery) return [];

  return fetchAll(
    `SELECT
        code,
        code_clean,
        title,
        body_text,
        section_title,
        page_start,
        page_end
     FROM nebs_entries
     WHERE (? <> '' AND (code = ? OR code LIKE ?))
        OR (? <> '' AND (code_clean = ? OR code_clean LIKE ?))
     ORDER BY
        CASE
          WHEN code = ? OR code_clean = ? THEN 0
          WHEN code LIKE ? OR code_clean LIKE ? THEN 1
          ELSE 2
        END,
        page_start ASC,
        LENGTH(code_clean) ASC
     LIMIT ?`,
    [
      rawQuery,
      rawQuery,
      `${rawQuery}%`,
      cleanQuery,
      cleanQuery,
      `${cleanQuery}%`,
      rawQuery,
      cleanQuery,
      `${rawQuery}%`,
      `${cleanQuery}%`,
      limit,
    ]
  ).map(rowToNebsEntry);
}

/**
 * @param {string} query
 * @returns {Array<Record<string, any>>}
 */
function searchTipi(query) {
  return ftsSearch(
    "tipi_fts",
    query,
    ["ncm", "capitulo", "descricao", "aliquota", "nivel", "ncm_sort"],
    "tipi_positions"
  );
}

/**
 * @param {string} query
 * @returns {Array<Record<string, any>>}
 */
function searchNesh(query) {
  return ftsSearch(
    "nesh_fts",
    query,
    ["codigo", "descricao", "chapter_num"],
    "nesh_positions"
  );
}

// ---------------------------------------------------------------------------
// Service detail helpers
// ---------------------------------------------------------------------------

function cleanServiceCode(code) {
  return String(code || "").replace(/[^0-9]/g, "");
}

function rowToNbsItem(row) {
  return {
    code: String(row.code || ""),
    code_clean: String(row.code_clean || ""),
    description: String(row.description || ""),
    parent_code: row.parent_code ? String(row.parent_code) : null,
    level: Number(row.level || 0),
    has_nebs: Boolean(row.has_nebs),
  };
}

function rowToNebsEntry(row) {
  if (!row) return null;
  return {
    code: String(row.code || ""),
    code_clean: String(row.code_clean || ""),
    title: String(row.title || ""),
    body_text: String(row.body_text || ""),
    body_markdown: row.body_markdown ? String(row.body_markdown) : null,
    title_normalized: row.title_normalized ? String(row.title_normalized) : "",
    body_normalized: row.body_normalized ? String(row.body_normalized) : "",
    section_title: row.section_title ? String(row.section_title) : null,
    page_start: Number(row.page_start || 0),
    page_end: Number(row.page_end || 0),
  };
}

function fetchOne(sql, bind = []) {
  const rows = _db.exec(sql, {
    bind,
    returnValue: "resultRows",
    rowMode: "object",
  });
  return rows?.[0] || null;
}

function fetchAll(sql, bind = []) {
  return (
    _db.exec(sql, {
      bind,
      returnValue: "resultRows",
      rowMode: "object",
    }) || []
  );
}

function fetchNbsItemByCode(code) {
  if (!_db) return null;
  const rawCode = String(code || "").trim();
  const cleanCode = cleanServiceCode(rawCode);
  if (!rawCode && !cleanCode) return null;

  const rows = fetchAll(
    `SELECT code, code_clean, description, parent_code, level, has_nebs
     FROM nbs_items
     WHERE (? <> '' AND code = ?)
        OR (? <> '' AND code_clean = ?)
     ORDER BY LENGTH(code_clean) DESC
     LIMIT 1`,
    [rawCode, rawCode, cleanCode, cleanCode]
  );
  return rows.length > 0 ? rowToNbsItem(rows[0]) : null;
}

function fetchAncestors(item) {
  const ancestors = [];
  let currentParent = item?.parent_code || null;
  let depth = 0;

  while (currentParent && depth < MAX_ANCESTOR_DEPTH) {
    const parent = fetchOne(
      `SELECT code, code_clean, description, parent_code, level, has_nebs
       FROM nbs_items
       WHERE code = ?
       LIMIT 1`,
      [currentParent]
    );
    if (!parent) break;
    ancestors.unshift(rowToNbsItem(parent));
    currentParent = parent.parent_code || null;
    depth += 1;
  }

  return ancestors;
}

function resolveHierarchyRoot(item, ancestors) {
  if (!item) return null;
  if (Number(item.level || 0) <= 1) return item;
  const chapterRoot = ancestors.find((ancestor) => ancestor.level === 1);
  return chapterRoot || ancestors[0] || item;
}

function fetchTreePage(rootCode, page = 1, pageSize = 50) {
  const normalizedPage = Math.max(Number(page || 1), 1);
  const normalizedPageSize = Math.min(Math.max(Number(pageSize || 50), 1), 200);
  const offset = (normalizedPage - 1) * normalizedPageSize;
  const countRow = fetchOne(
    `SELECT COUNT(*) AS total
     FROM nbs_items
     WHERE code = ? OR code LIKE ?`,
    [rootCode, `${rootCode}%`]
  );
  const total = Number(countRow?.total || 0);
  const items = fetchAll(
    `SELECT code, code_clean, description, parent_code, level, has_nebs
     FROM nbs_items
     WHERE code = ? OR code LIKE ?
     ORDER BY source_order ASC
     LIMIT ? OFFSET ?`,
    [rootCode, `${rootCode}%`, normalizedPageSize, offset]
  ).map(rowToNbsItem);

  return {
    items,
    page: normalizedPage,
    page_size: normalizedPageSize,
    total,
    has_more: offset + items.length < total,
  };
}

function getLocalNbsDetail(code, page = 1, pageSize = 50) {
  if (!_db) return null;
  const item = fetchNbsItemByCode(code);
  if (!item) return null;

  const ancestors = fetchAncestors(item);
  const children = fetchAll(
    `SELECT code, code_clean, description, parent_code, level, has_nebs
     FROM nbs_items
     WHERE parent_code = ?
     ORDER BY source_order ASC`,
    [item.code]
  ).map(rowToNbsItem);
  const chapterRoot = resolveHierarchyRoot(item, ancestors);
  const chapterPage = chapterRoot
    ? fetchTreePage(chapterRoot.code, page, pageSize)
    : null;
  const nebsEntry = fetchOne(
    `SELECT
        code,
        code_clean,
        title,
        body_text,
        section_title,
        page_start,
        page_end
     FROM nebs_entries
     WHERE code = ? OR code_clean = ?
     ORDER BY LENGTH(code_clean) DESC
     LIMIT 1`,
    [item.code, item.code_clean]
  );

  return {
    success: true,
    item,
    ancestors,
    children,
    chapter_root: chapterRoot,
    chapter_items: chapterPage?.items || [],
    chapter_page: chapterPage,
    nebs: rowToNebsEntry(nebsEntry),
  };
}

function getLocalNebsDetail(code) {
  if (!_db) return null;
  const item = fetchNbsItemByCode(code);
  if (!item) return null;

  const cleanCode = cleanServiceCode(code);
  const entry = fetchOne(
    `SELECT
        code,
        code_clean,
        title,
        body_text,
        section_title,
        page_start,
        page_end
     FROM nebs_entries
     WHERE (? <> '' AND code = ?)
        OR (? <> '' AND code_clean = ?)
     ORDER BY LENGTH(code_clean) DESC
     LIMIT 1`,
    [code, code, cleanCode, cleanCode]
  );
  if (!entry) return null;

  return {
    success: true,
    item,
    ancestors: fetchAncestors(item),
    entry: rowToNebsEntry(entry),
  };
}

function postWorkerProgress(id, progress, step) {
  postMessage({
    type: "PROGRESS",
    id,
    payload: { progress, step },
  });
}

function postWorkerStatus(id, payload) {
  postMessage({
    type: "STATUS",
    id,
    payload,
  });
}

function postWorkerResult(id, payload) {
  postMessage({
    type: "RESULT",
    id,
    payload,
  });
}

function postWorkerError(id, error) {
  postMessage({
    type: "ERROR",
    id,
    payload: { error },
  });
}

function queryResultRows(sql, bind = []) {
  if (!_db) return [];
  try {
    return _db.exec(sql, {
      bind,
      returnValue: "resultRows",
      rowMode: "object",
    });
  } catch {
    return [];
  }
}

function queryFirstOptionalRow(sql, bind = []) {
  const rows = queryResultRows(sql, bind);
  return rows.length > 0 ? rows[0] : null;
}

// ---------------------------------------------------------------------------
// Code Search functions (hierarchy reconstruction)
// ---------------------------------------------------------------------------

function resolveTipiTargetPosition(clean, formatted, part) {
  if (clean.length <= 2) return null;
  return formatted.trim() || part.trim();
}

function getTipiChapterRows(capNum, clean, viewMode) {
  if (viewMode !== "family" || clean.length <= 2) {
    return queryResultRows(
      `SELECT ncm, capitulo, descricao, aliquota, nivel
       FROM tipi_positions
       WHERE capitulo = ?
       ORDER BY ncm_sort, ncm`,
      [capNum]
    );
  }

  const ancestors = buildAncestorPrefixes(clean);
  const conditions = ["REPLACE(ncm, '.', '') LIKE ? || '%'"];
  const params = [clean];

  for (const ancestor of ancestors) {
    conditions.push("REPLACE(ncm, '.', '') = ?");
    params.push(ancestor);
  }

  return queryResultRows(
    `SELECT ncm, capitulo, descricao, aliquota, nivel
     FROM tipi_positions
     WHERE capitulo = ? AND (${conditions.join(" OR ")})
     ORDER BY ncm_sort, ncm`,
    [capNum, ...params]
  );
}

function mergeTipiSearchResults(merged, partResult) {
  for (const [cap, capData] of Object.entries(partResult)) {
    if (!merged[cap]) {
      merged[cap] = { ...capData, posicoes: [] };
    }
    merged[cap].posicao_alvo = preferMoreSpecific(
      merged[cap].posicao_alvo,
      capData.posicao_alvo
    );
    const seenNcms = new Set(merged[cap].posicoes.map((p) => p.ncm));
    for (const pos of capData.posicoes) {
      if (!seenNcms.has(pos.ncm)) {
        merged[cap].posicoes.push(pos);
        seenNcms.add(pos.ncm);
      }
    }
  }
}

function collectNeshChapterTargets(query) {
  /** @type {Map<string, [string, string|null]>} */
  const chapterTargets = new Map();

  for (const part of splitNcmQuery(query)) {
    const [chapter, target] = extractChapterFromNcm(part);
    if (!chapter || chapterTargets.has(chapter)) continue;
    chapterTargets.set(chapter, [part, target]);
    if (chapterTargets.size >= MULTI_CODE_MAX_PARTS) break;
  }

  return chapterTargets;
}

function getNeshChapterSearchData(chapterNum) {
  // Consolidated: fetch chapter content + notes in a single query
  const chapterAndNotes = queryFirstOptionalRow(
    `SELECT c.content,
            n.notes_content, n.titulo, n.notas,
            n.consideracoes, n.definicoes, n.parsed_notes_json
     FROM nesh_chapters c
     LEFT JOIN nesh_chapter_notes n ON n.chapter_num = c.chapter_num
     WHERE c.chapter_num = ?`,
    [chapterNum]
  );

  return {
    positions: queryResultRows(
      `SELECT codigo, descricao FROM nesh_positions WHERE chapter_num = ? ORDER BY codigo`,
      [chapterNum]
    ),
    chapterData: chapterAndNotes ? { content: chapterAndNotes.content } : null,
    notesData: chapterAndNotes
      ? {
          notes_content: chapterAndNotes.notes_content,
          titulo: chapterAndNotes.titulo,
          notas: chapterAndNotes.notas,
          consideracoes: chapterAndNotes.consideracoes,
          definicoes: chapterAndNotes.definicoes,
          parsed_notes_json: chapterAndNotes.parsed_notes_json,
        }
      : null,
  };
}

function buildMissingNeshChapterResult(chapterNum, ncmBuscado) {
  return {
    ncm_buscado: ncmBuscado,
    capitulo: chapterNum,
    real_content_found: false,
    erro: `Capítulo ${chapterNum} não encontrado`,
    conteudo: "",
    posicoes: [],
    notas_gerais: null,
    notas_parseadas: {},
    posicao_alvo: null,
  };
}

/**
 * Search TIPI by NCM code, reconstructing the full chapter hierarchy.
 * Supports multi-NCM queries (e.g. "8413, 8517").
 * Replicates TipiService.search_by_code from the Python backend.
 *
 * @param {string} query - NCM code(s)
 * @param {string} viewMode - "family" or "chapter"
 * @returns {{ type: string, results: Record<string, any>, total: number, total_capitulos: number }}
 */
function searchTipiByCode(query, viewMode = "family") {
  if (!_db) return { type: "code", results: {}, total: 0, total_capitulos: 0 };

  const parts = splitNcmQuery(query);
  const uniqueParts = [...new Set(parts.map(cleanNcm).filter(Boolean))];
  const limitedParts = uniqueParts.slice(0, MULTI_CODE_MAX_PARTS);

  if (limitedParts.length === 0) {
    return { type: "code", query, results: {}, total: 0, total_capitulos: 0 };
  }

  /** @type {Record<string, any>} */
  const merged = {};

  for (const part of limitedParts) {
    const formatted = formatNcmTipi(part);
    const clean = cleanNcm(formatted);
    if (!clean) continue;

    const capNum = clean.slice(0, 2).padStart(2, "0");
    const posicaoAlvo = resolveTipiTargetPosition(clean, formatted, part);
    const rows = getTipiChapterRows(capNum, clean, viewMode);

    if (!rows || rows.length === 0) continue;

    const partResult = buildTipiHierarchy(rows, part, posicaoAlvo);
    mergeTipiSearchResults(merged, partResult);
  }

  const total = Object.values(merged).reduce(
    (s, c) => s + (c.posicoes?.length || 0),
    0
  );

  return {
    type: "code",
    query,
    results: merged,
    resultados: merged,
    total,
    total_capitulos: Object.keys(merged).length,
    success: true,
  };
}

/**
 * Search NESH by NCM code, reconstructing the full chapter with content.
 * Supports multi-NCM queries.
 * Replicates NeshService.search_by_code from the Python backend.
 *
 * @param {string} query - NCM code(s)
 * @returns {{ type: string, results: Record<string, any>, total_capitulos: number }}
 */
function searchNeshByCode(query) {
  if (!_db)
    return { type: "code", results: {}, total_capitulos: 0, success: true };

  const chapterTargets = collectNeshChapterTargets(query);

  if (chapterTargets.size === 0) {
    return {
      type: "code",
      query,
      normalized: null,
      results: {},
      total_capitulos: 0,
      success: true,
    };
  }

  /** @type {Record<string, any>} */
  const results = {};

  for (const [chapterNum, [ncmBuscado, targetPos]] of chapterTargets) {
    const { positions, chapterData, notesData } =
      getNeshChapterSearchData(chapterNum);

    if (!positions || positions.length === 0) {
      results[chapterNum] = buildMissingNeshChapterResult(
        chapterNum,
        ncmBuscado
      );
      continue;
    }

    results[chapterNum] = buildNeshChapterResult(
      chapterNum,
      ncmBuscado,
      targetPos,
      positions,
      chapterData,
      notesData
    );
  }

  return {
    type: "code",
    query,
    normalized: null,
    results,
    total_capitulos: Object.keys(results).length,
    success: true,
  };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

async function handleInitMessage(id, payload) {
  const encData = await readFromOpfs();
  const version = await readVersion();

  if (!encData || !version) {
    _status = "not_installed";
    postWorkerStatus(id, { status: "not_installed" });
    return;
  }

  _status = "checking";
  postWorkerStatus(id, { status: "checking" });

  const chunkSize = payload?.chunkSize || 65536;
  const iterations = payload?.pbkdf2Iterations || 600000;
  /** @type {Uint8Array | null} */
  let plaintext = null;

  try {
    plaintext = await decryptDatabase(encData, chunkSize, iterations);
    await loadDatabaseFromBytes(plaintext);
  } catch (err) {
    if (plaintext) {
      plaintext.fill(0);
    }
    if (_db) {
      try {
        _db.close();
      } catch {
        /* ignore */
      }
      _db = null;
    }
    _currentVersion = null;
    _status = "error";
    await removeFromOpfs();
    const message = err instanceof Error ? err.message : "Unknown error";
    postWorkerStatus(id, {
      status: "error",
      error: `${message}. Reinstale o banco offline para continuar.`,
      recoverable: true,
    });
    postWorkerError(id, `${message}. Reinstale o banco offline para continuar.`);
    return;
  }

  plaintext.fill(0);

  _status = "ready";
  _currentVersion = version;
  postWorkerStatus(id, {
    status: "ready",
    version: _currentVersion,
    sizeBytes: encData.length,
  });
}

async function readEncryptedDatabaseBlob(dlResp, id) {
  const contentLength = parseInt(dlResp.headers.get("content-length") || "0", 10);
  const reader = dlResp.body?.getReader();
  if (!reader) throw new Error("No response body");

  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;

    if (contentLength > 0) {
      const dlProgress = 10 + Math.round((received / contentLength) * 60);
      postWorkerProgress(id, dlProgress, "fetching_database");
    }
  }

  const encryptedBlob = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    encryptedBlob.set(chunk, offset);
    offset += chunk.length;
  }

  return encryptedBlob;
}

async function requestInstallToken(apiBase) {
  const tokenResp = await fetch(`${apiBase}/database/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    throw new Error(`Token request failed (${tokenResp.status}): ${errText}`);
  }

  return tokenResp.json();
}

async function fetchEncryptedDatabase(apiBase, token) {
  const dlResp = await fetch(`${apiBase}/database/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!dlResp.ok) {
    const errText = await dlResp.text();
    throw new Error(`Offline database retrieval failed (${dlResp.status}): ${errText}`);
  }

  return dlResp;
}

async function updateInstalledVersion(apiBase) {
  try {
    const versionResp = await fetch(`${apiBase}/database/version`);
    if (versionResp.ok) {
      const vData = await versionResp.json();
      _currentVersion = vData.version;
    }
  } catch {
    _currentVersion = new Date().toISOString().slice(0, 10);
  }

  await saveVersion(_currentVersion || "unknown");
}

async function handleInstallMessage(id, payload) {
  _status = "installing";
  postWorkerProgress(id, 0, "requesting_token");

  const apiBase = payload?.apiBase || "/api";
  const tokenData = await requestInstallToken(apiBase);
  const {
    token,
    encrypted_sha256: expectedEncryptedSha256,
    chunk_size: chunkSize = 65536,
    pbkdf2_iterations: iterations = 600000,
  } = tokenData;

  postWorkerProgress(id, 10, "fetching_database");

  const dlResp = await fetchEncryptedDatabase(apiBase, token);
  const encryptedBlob = await readEncryptedDatabaseBlob(dlResp, id);

  if (expectedEncryptedSha256) {
    postWorkerProgress(id, 72, "verifying_integrity");
    const actualEncryptedSha256 = await sha256Hex(encryptedBlob);
    if (actualEncryptedSha256 !== expectedEncryptedSha256) {
      throw new Error("Offline database integrity verification failed");
    }
  }

  postWorkerProgress(id, 75, "decrypting");
  const plaintext = await decryptDatabase(encryptedBlob, chunkSize, iterations);

  postWorkerProgress(id, 85, "loading");
  await loadDatabaseFromBytes(plaintext);
  plaintext.fill(0);

  postWorkerProgress(id, 90, "saving");
  await saveToOpfs(encryptedBlob);
  await updateInstalledVersion(apiBase);

  _status = "ready";
  postWorkerProgress(id, 100, "done");
  postWorkerStatus(id, {
    status: "ready",
    version: _currentVersion,
    sizeBytes: encryptedBlob.length,
  });
}

function runStructuredSearch(docType, query, viewMode) {
  if (!isCodeQuery(query)) {
    switch (docType) {
      case "nbs":
        return { results: searchNbs(query), searchType: "text" };
      case "nebs":
        return { results: searchNebs(query), searchType: "text" };
      case "tipi":
      case "ncm":
        return { results: searchTipi(query), searchType: "text" };
      case "nesh":
        return { results: searchNesh(query), searchType: "text" };
      default:
        return { results: [], searchType: "text" };
    }
  }

  switch (docType) {
    case "tipi":
      return {
        results: searchTipiByCode(query, viewMode || "family").results,
        searchType: "code",
      };
    case "nesh":
      return {
        results: searchNeshByCode(query).results,
        searchType: "code",
      };
    case "nbs":
      return { results: searchNbsByCode(query), searchType: "text" };
    case "nebs":
      return { results: searchNebsByCode(query), searchType: "text" };
    default:
      return { results: [], searchType: "text" };
  }
}

function handleSearchMessage(id, payload) {
  if (!_db || _status !== "ready") {
    postWorkerResult(id, { results: null, source: "not_ready" });
    return;
  }

  const t0 = performance.now();
  const { docType, query, viewMode } = payload;
  const cacheKey = _getCacheKey(docType, query, viewMode);

  // Check LRU cache first
  const cached = _getCachedResult(cacheKey);
  if (cached) {
    const totalDurationMs = performance.now() - t0;
    postWorkerResult(id, {
      results: cached.results,
      source: "local",
      docType,
      query,
      searchType: cached.searchType,
      timing: { sqlDurationMs: 0, totalDurationMs, cacheHit: true },
    });
    return;
  }

  const sqlStart = performance.now();
  const { results, searchType } = runStructuredSearch(docType, query, viewMode);
  const sqlDurationMs = performance.now() - sqlStart;

  // Store in LRU cache
  _setCachedResult(cacheKey, { results, searchType });

  const totalDurationMs = performance.now() - t0;
  postWorkerResult(id, {
    results,
    source: "local",
    docType,
    query,
    searchType,
    timing: { sqlDurationMs, totalDurationMs, cacheHit: false },
  });
}

function handleNbsDetailMessage(id, payload) {
  if (!_db || _status !== "ready") {
    postWorkerResult(id, { detail: null, source: "not_ready" });
    return;
  }

  const detail = getLocalNbsDetail(
    String(payload.code || ""),
    Number(payload.page || 1),
    Number(payload.pageSize || 50)
  );
  postWorkerResult(id, { detail, source: "local" });
}

function handleNebsDetailMessage(id, payload) {
  if (!_db || _status !== "ready") {
    postWorkerResult(id, { detail: null, source: "not_ready" });
    return;
  }

  const detail = getLocalNebsDetail(String(payload.code || ""));
  postWorkerResult(id, { detail, source: "local" });
}

function handleGetStatusMessage(id) {
  postWorkerStatus(id, {
    status: _status,
    version: _currentVersion,
  });
}

async function handleRemoveMessage(id) {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* ignore */
    }
    _db = null;
  }
  _currentVersion = null;
  _status = "not_installed";
  _clearSearchCache();

  await removeFromOpfs();
  postWorkerStatus(id, { status: "not_installed" });
}

async function dispatchWorkerMessage(type, id, payload) {
  switch (type) {
    case "INIT":
      await handleInitMessage(id, payload);
      return;
    case "INSTALL":
      await handleInstallMessage(id, payload);
      return;
    case "SEARCH":
      handleSearchMessage(id, payload);
      return;
    case "GET_NBS_DETAIL":
      handleNbsDetailMessage(id, payload);
      return;
    case "GET_NEBS_DETAIL":
      handleNebsDetailMessage(id, payload);
      return;
    case "GET_STATUS":
      handleGetStatusMessage(id);
      return;
    case "REMOVE":
      await handleRemoveMessage(id);
      return;
    default:
      postWorkerError(id, `Unknown message type: ${type}`);
  }
}

/**
 * @param {MessageEvent} event
 */
self.onmessage = async (event) => {
  const { type, id, payload } = event.data;

  try {
    await dispatchWorkerMessage(type, id, payload);
  } catch (err) {
    _status = "error";
    postWorkerError(id, err instanceof Error ? err.message : "Unknown error");
  }
};

// Signal that the Worker is ready
postMessage({ type: "READY", id: null, payload: {} });
