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
 * 5. Anti-debugging measures
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
// Anti-debugging (lightweight — no heavy obfuscator cost)
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
    error: () => {},
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
 * @param {CryptoKey} aesKey - We derive HMAC key from AES key material via SHA-256
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

  // Dynamic import of sqlite wasm
  const { default: sqlite3InitModule } = await import(
    /* @vite-ignore */
    "@sqlite.org/sqlite-wasm"
  );

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

  // Verify DB is usable
  const testResult = _db.exec("SELECT value FROM db_metadata WHERE key='version'", {
    returnValue: "resultRows",
  });
  if (testResult && testResult.length > 0) {
    _currentVersion = testResult[0][0];
  }
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
    .replace(/["\\']/g, "")
    .replace(/[{}()[\]^~*?:!]/g, " ")
    .trim();

  if (!sanitized) return [];

  // Build FTS5 match expression with prefix matching
  const terms = sanitized.split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return [];

  const matchExpr = terms.map((t) => `"${t}"*`).join(" ");
  const colList = columns.join(", ");

  try {
    const sql = `
      SELECT ${colList}
      FROM ${contentTable}
      WHERE rowid IN (
        SELECT rowid FROM ${table} WHERE ${table} MATCH ?
        ORDER BY rank
        LIMIT ?
      )
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
      const sql = `SELECT ${colList} FROM ${contentTable} WHERE ${likeClause} LIMIT ?`;
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

// ---------------------------------------------------------------------------
// Code Search functions (hierarchy reconstruction)
// ---------------------------------------------------------------------------

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

    // Resolve posicao_alvo
    let posicaoAlvo = null;
    if (clean.length > 2) {
      posicaoAlvo = formatted.trim() || part.trim();
    }

    let rows;
    if (viewMode === "family" && clean.length > 2) {
      // Family view: get only the family branch + ancestors
      const ancestors = buildAncestorPrefixes(clean);
      const conditions = ["REPLACE(ncm, '.', '') LIKE ? || '%'"];
      const params = [clean];

      for (const ancestor of ancestors) {
        conditions.push("REPLACE(ncm, '.', '') = ?");
        params.push(ancestor);
      }

      const whereClause = conditions.join(" OR ");
      try {
        rows = _db.exec(
          `SELECT ncm, capitulo, descricao, aliquota, nivel
           FROM tipi_positions
           WHERE capitulo = ? AND (${whereClause})
           ORDER BY ncm_sort, ncm`,
          {
            bind: [capNum, ...params],
            returnValue: "resultRows",
            rowMode: "object",
          }
        );
      } catch {
        rows = [];
      }
    } else {
      // Chapter view: get entire chapter
      try {
        rows = _db.exec(
          `SELECT ncm, capitulo, descricao, aliquota, nivel
           FROM tipi_positions
           WHERE capitulo = ?
           ORDER BY ncm_sort, ncm`,
          {
            bind: [capNum],
            returnValue: "resultRows",
            rowMode: "object",
          }
        );
      } catch {
        rows = [];
      }
    }

    if (!rows || rows.length === 0) continue;

    const partResult = buildTipiHierarchy(rows, part, posicaoAlvo);

    // Merge into accumulated results
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

  const parts = splitNcmQuery(query);
  /** @type {Map<string, [string, string|null]>} */
  const chapterTargets = new Map();

  for (const part of parts) {
    const [chapter, target] = extractChapterFromNcm(part);
    if (!chapter) continue;
    if (!chapterTargets.has(chapter)) {
      chapterTargets.set(chapter, [part, target]);
    }
    if (chapterTargets.size >= MULTI_CODE_MAX_PARTS) break;
  }

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
    // Get positions
    let positions;
    try {
      positions = _db.exec(
        `SELECT codigo, descricao FROM nesh_positions WHERE chapter_num = ? ORDER BY codigo`,
        { bind: [chapterNum], returnValue: "resultRows", rowMode: "object" }
      );
    } catch {
      positions = [];
    }

    // Get chapter content
    let chapterData = null;
    try {
      const chRows = _db.exec(
        `SELECT content FROM nesh_chapters WHERE chapter_num = ?`,
        { bind: [chapterNum], returnValue: "resultRows", rowMode: "object" }
      );
      if (chRows && chRows.length > 0) chapterData = chRows[0];
    } catch {
      /* table may not exist in older DBs */
    }

    // Get notes
    let notesData = null;
    try {
      const noteRows = _db.exec(
        `SELECT notes_content, titulo, notas, consideracoes, definicoes, parsed_notes_json
         FROM nesh_chapter_notes WHERE chapter_num = ?`,
        { bind: [chapterNum], returnValue: "resultRows", rowMode: "object" }
      );
      if (noteRows && noteRows.length > 0) notesData = noteRows[0];
    } catch {
      /* table may not exist in older DBs */
    }

    if (!positions || positions.length === 0) {
      results[chapterNum] = {
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
// Anti-debugging (timing-based)
// ---------------------------------------------------------------------------
let _lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  // If interval drifted >2s, a debugger breakpoint was likely hit
  if (now - _lastTick > 2000) {
    if (_db) {
      try {
        _db.close();
      } catch {
        /* ignore */
      }
      _db = null;
    }
    _status = "error";
  }
  _lastTick = now;
}, 500);

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

/**
 * @param {MessageEvent} event
 */
self.onmessage = async (event) => {
  const { type, id, payload } = event.data;

  try {
    switch (type) {
      case "INIT": {
        // Check if we have an encrypted DB in OPFS
        const encData = await readFromOpfs();
        const version = await readVersion();

        if (encData && version) {
          _status = "checking";
          postMessage({ type: "STATUS", id, payload: { status: "checking" } });

          // Decrypt and load
          const chunkSize = payload?.chunkSize || 65536;
          const iterations = payload?.pbkdf2Iterations || 600000;
          const plaintext = await decryptDatabase(
            encData,
            chunkSize,
            iterations
          );
          await loadDatabaseFromBytes(plaintext);
          // Zero out plaintext buffer
          plaintext.fill(0);

          _status = "ready";
          _currentVersion = version;
          postMessage({
            type: "STATUS",
            id,
            payload: {
              status: "ready",
              version: _currentVersion,
              sizeBytes: encData.length,
            },
          });
        } else {
          _status = "not_installed";
          postMessage({
            type: "STATUS",
            id,
            payload: { status: "not_installed" },
          });
        }
        break;
      }

      case "INSTALL": {
        _status = "installing";
        postMessage({
          type: "PROGRESS",
          id,
          payload: { progress: 0, step: "requesting_token" },
        });

        const apiBase = payload?.apiBase || "/api";

        // Step 1: Get download token
        const tokenResp = await fetch(`${apiBase}/database/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (!tokenResp.ok) {
          const errText = await tokenResp.text();
          throw new Error(
            `Token request failed (${tokenResp.status}): ${errText}`
          );
        }

        const tokenData = await tokenResp.json();
        const {
          token,
          encrypted_sha256: expectedEncryptedSha256,
          chunk_size: chunkSize = 65536,
          pbkdf2_iterations: iterations = 600000,
        } = tokenData;

        postMessage({
          type: "PROGRESS",
          id,
          payload: { progress: 10, step: "downloading" },
        });

        // Step 2: Download encrypted database
        const dlResp = await fetch(`${apiBase}/database/download`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        if (!dlResp.ok) {
          const errText = await dlResp.text();
          throw new Error(
            `Download failed (${dlResp.status}): ${errText}`
          );
        }

        // Read with progress
        const contentLength = parseInt(
          dlResp.headers.get("content-length") || "0",
          10
        );
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
            postMessage({
              type: "PROGRESS",
              id,
              payload: { progress: dlProgress, step: "downloading" },
            });
          }
        }

        // Combine chunks
        const encryptedBlob = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
          encryptedBlob.set(chunk, offset);
          offset += chunk.length;
        }

        if (expectedEncryptedSha256) {
          postMessage({
            type: "PROGRESS",
            id,
            payload: { progress: 72, step: "verifying_download" },
          });
          const actualEncryptedSha256 = await sha256Hex(encryptedBlob);
          if (actualEncryptedSha256 !== expectedEncryptedSha256) {
            throw new Error("Download integrity verification failed");
          }
        }

        postMessage({
          type: "PROGRESS",
          id,
          payload: { progress: 75, step: "decrypting" },
        });

        // Step 3: Decrypt
        const plaintext = await decryptDatabase(
          encryptedBlob,
          chunkSize,
          iterations
        );

        postMessage({
          type: "PROGRESS",
          id,
          payload: { progress: 85, step: "loading" },
        });

        // Step 4: Load into SQLite WASM memory
        await loadDatabaseFromBytes(plaintext);

        // Zero out plaintext
        plaintext.fill(0);

        postMessage({
          type: "PROGRESS",
          id,
          payload: { progress: 90, step: "saving" },
        });

        // Step 5: Save ENCRYPTED blob to OPFS (never plaintext)
        await saveToOpfs(encryptedBlob);

        // Step 6: Fetch and save version
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

        _status = "ready";
        postMessage({
          type: "PROGRESS",
          id,
          payload: { progress: 100, step: "done" },
        });
        postMessage({
          type: "STATUS",
          id,
          payload: {
            status: "ready",
            version: _currentVersion,
            sizeBytes: encryptedBlob.length,
          },
        });
        break;
      }

      case "SEARCH": {
        if (!_db || _status !== "ready") {
          postMessage({
            type: "RESULT",
            id,
            payload: { results: null, source: "not_ready" },
          });
          break;
        }

        const { docType, query, viewMode } = payload;
        let results;
        let searchType = "text";

        // Code search: reconstruct hierarchy locally
        if (isCodeQuery(query)) {
          if (docType === "tipi") {
            searchType = "code";
            const codeResult = searchTipiByCode(query, viewMode || "family");
            results = codeResult.results;
          } else if (docType === "nesh") {
            searchType = "code";
            const codeResult = searchNeshByCode(query);
            results = codeResult.results;
          } else if (docType === "nbs") {
            results = searchNbsByCode(query);
          } else if (docType === "nebs") {
            results = searchNebsByCode(query);
          } else {
            results = [];
          }
        } else {
          // Text/FTS search (existing logic)
          switch (docType) {
            case "nbs":
              results = searchNbs(query);
              break;
            case "nebs":
              results = searchNebs(query);
              break;
            case "tipi":
            case "ncm":
              results = searchTipi(query);
              break;
            case "nesh":
              results = searchNesh(query);
              break;
            default:
              results = [];
          }
        }

        postMessage({
          type: "RESULT",
          id,
          payload: { results, source: "local", docType, query, searchType },
        });
        break;
      }

      case "GET_NBS_DETAIL": {
        if (!_db || _status !== "ready") {
          postMessage({
            type: "RESULT",
            id,
            payload: { detail: null, source: "not_ready" },
          });
          break;
        }

        const detail = getLocalNbsDetail(
          String(payload.code || ""),
          Number(payload.page || 1),
          Number(payload.pageSize || 50)
        );
        postMessage({
          type: "RESULT",
          id,
          payload: { detail, source: "local" },
        });
        break;
      }

      case "GET_NEBS_DETAIL": {
        if (!_db || _status !== "ready") {
          postMessage({
            type: "RESULT",
            id,
            payload: { detail: null, source: "not_ready" },
          });
          break;
        }

        const detail = getLocalNebsDetail(String(payload.code || ""));
        postMessage({
          type: "RESULT",
          id,
          payload: { detail, source: "local" },
        });
        break;
      }

      case "GET_STATUS": {
        postMessage({
          type: "STATUS",
          id,
          payload: {
            status: _status,
            version: _currentVersion,
          },
        });
        break;
      }

      case "REMOVE": {
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

        await removeFromOpfs();

        postMessage({
          type: "STATUS",
          id,
          payload: { status: "not_installed" },
        });
        break;
      }

      default:
        postMessage({
          type: "ERROR",
          id,
          payload: { error: `Unknown message type: ${type}` },
        });
    }
  } catch (err) {
    _status = "error";
    postMessage({
      type: "ERROR",
      id,
      payload: {
        error: err instanceof Error ? err.message : "Unknown error",
      },
    });
  }
};

// Signal that the Worker is ready
postMessage({ type: "READY", id: null, payload: {} });
