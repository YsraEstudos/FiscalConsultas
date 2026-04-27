import { MAX_ANCESTOR_DEPTH } from "./constants.js";
import { fetchAll, fetchOne } from "./query.js";
import { getWorkerDb } from "./state.js";

const NON_TEXT_SEARCH_COLUMNS = new Set(["level"]);

/**
 * Execute an FTS5 search query with a LIKE fallback.
 * @param {string} table
 * @param {string} query
 * @param {string[]} columns
 * @param {string} contentTable
 * @param {number} limit
 * @returns {Array<Record<string, any>>}
 */
export function ftsSearch(
  table,
  query,
  columns,
  contentTable,
  limit = 50
) {
  const db = getWorkerDb();
  if (!db) return [];

  const sanitized = query
    .replace(/["\\']/g, "")
    .replace(/[{}()[\]^~*?:!]/g, " ")
    .trim();
  if (!sanitized) return [];

  const terms = sanitized.split(/\s+/).filter((term) => term.length > 0);
  if (terms.length === 0) return [];

  const matchExpr = terms.map((term) => `"${term}"*`).join(" ");
  const colList = columns.map((column) => `ct.${column}`).join(", ");

  try {
    const sql = `
      SELECT ${colList}
      FROM ${table}(?) AS ft
      JOIN ${contentTable} AS ct ON ct.rowid = ft.rowid
      ORDER BY rank
      LIMIT ?
    `;
    const rows = db.exec(sql, {
      bind: [matchExpr, limit],
      returnValue: "resultRows",
      rowMode: "object",
    });
    return rows || [];
  } catch {
    try {
      const textColumns = columns.filter(
        (column) => !NON_TEXT_SEARCH_COLUMNS.has(column)
      );
      if (textColumns.length === 0) return [];

      const textLikeClause = textColumns
        .map((column) => `${column} LIKE ? ESCAPE '\\'`)
        .join(" OR ");
      const likeClause = terms
        .map(() => `(${textLikeClause})`)
        .join(" AND ");
      const likeParams = terms.flatMap((term) =>
        textColumns.map(() => `%${escapeLikePattern(term)}%`)
      );
      const fallbackColList = textColumns.join(", ");
      const sql = `SELECT ${fallbackColList} FROM ${contentTable} WHERE ${likeClause} LIMIT ?`;
      const rows = db.exec(sql, {
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

export function searchNbsByText(query) {
  return ftsSearch(
    "nbs_fts",
    query,
    ["code", "code_clean", "description", "parent_code", "level"],
    "nbs_items"
  );
}

function cleanServiceCode(code) {
  return String(code || "").replace(/[^0-9]/g, "");
}

function escapeLikePattern(value) {
  return String(value || "").replace(/[\\%_]/g, "\\$&");
}

function rowToNbsItem(row) {
  return {
    code: String(row.code || ""),
    code_clean: String(row.code_clean || ""),
    description: String(row.description || ""),
    parent_code: row.parent_code ? String(row.parent_code) : null,
    level: Number(row.level || 0),
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

export function searchNbsByCode(query, limit = 50) {
  const rawQuery = String(query || "").trim();
  const cleanQuery = cleanServiceCode(rawQuery);
  if (!rawQuery && !cleanQuery) return [];

  const rawPrefix = `${escapeLikePattern(rawQuery)}%`;
  const cleanPrefix = `${escapeLikePattern(cleanQuery)}%`;

  return fetchAll(
    `SELECT
        code,
        code_clean,
        description,
        parent_code,
        level
     FROM nbs_items
     WHERE (? <> '' AND (code = ? OR code LIKE ? ESCAPE '\\'))
        OR (? <> '' AND (code_clean = ? OR code_clean LIKE ? ESCAPE '\\'))
     ORDER BY
        CASE
          WHEN code = ? OR code_clean = ? THEN 0
          WHEN code LIKE ? ESCAPE '\\' OR code_clean LIKE ? ESCAPE '\\' THEN 1
          ELSE 2
        END,
        level ASC,
        source_order ASC,
        LENGTH(code_clean) ASC
     LIMIT ?`,
    [
      rawQuery,
      rawQuery,
      rawPrefix,
      cleanQuery,
      cleanQuery,
      cleanPrefix,
      rawQuery,
      cleanQuery,
      rawPrefix,
      cleanPrefix,
      limit,
    ]
  ).map(rowToNbsItem);
}

function fetchNbsItemByCode(code) {
  const rawCode = String(code || "").trim();
  const cleanCode = cleanServiceCode(rawCode);
  if (!rawCode && !cleanCode) return null;

  const rows = fetchAll(
    `SELECT code, code_clean, description, parent_code, level
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
      `SELECT code, code_clean, description, parent_code, level
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
  const rootPrefix = `${escapeLikePattern(rootCode)}%`;
  const countRow = fetchOne(
    `SELECT COUNT(*) AS total
     FROM nbs_items
     WHERE code = ? OR code LIKE ? ESCAPE '\\'`,
    [rootCode, rootPrefix]
  );
  const total = Number(countRow?.total || 0);
  const items = fetchAll(
    `SELECT code, code_clean, description, parent_code, level
     FROM nbs_items
     WHERE code = ? OR code LIKE ? ESCAPE '\\'
     ORDER BY source_order ASC
     LIMIT ? OFFSET ?`,
    [rootCode, rootPrefix, normalizedPageSize, offset]
  ).map(rowToNbsItem);

  return {
    items,
    page: normalizedPage,
    page_size: normalizedPageSize,
    total,
    has_more: offset + items.length < total,
  };
}

export function getLocalNbsDetail(code, page = 1, pageSize = 50) {
  if (!getWorkerDb()) return null;

  const item = fetchNbsItemByCode(code);
  if (!item) return null;

  const ancestors = fetchAncestors(item);
  const children = fetchAll(
    `SELECT code, code_clean, description, parent_code, level
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
        body_markdown,
        section_title,
        page_start,
        page_end
     FROM nebs_entries
     WHERE (code = ? OR code_clean = ?)
       AND parser_status = 'trusted'
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

