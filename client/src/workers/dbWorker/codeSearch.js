import {
  buildAncestorPrefixes,
  buildNeshChapterResult,
  buildTipiHierarchy,
  cleanNcm,
  extractChapterFromNcm,
  formatNcmTipi,
  preferMoreSpecific,
  splitNcmQuery,
} from "../workerUtils.js";
import { MULTI_CODE_MAX_PARTS } from "./constants.js";
import { ftsSearch } from "./catalogSearch.js";
import { queryFirstOptionalRow, queryResultRows } from "./query.js";
import { getWorkerDb } from "./state.js";

export function searchTipiByText(query) {
  return ftsSearch(
    "tipi_fts",
    query,
    ["ncm", "capitulo", "descricao", "aliquota", "nivel", "ncm_sort"],
    "tipi_positions"
  );
}

export function searchNeshByText(query) {
  return ftsSearch(
    "nesh_fts",
    query,
    ["codigo", "descricao", "chapter_num"],
    "nesh_positions"
  );
}

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
    const seenNcms = new Set(merged[cap].posicoes.map((position) => position.ncm));
    for (const position of capData.posicoes) {
      if (!seenNcms.has(position.ncm)) {
        merged[cap].posicoes.push(position);
        seenNcms.add(position.ncm);
      }
    }
  }
}

function collectNeshChapterTargets(query) {
  /** @type {Map<string, [string, string | null]>} */
  const chapterTargets = new Map();

  for (const part of splitNcmQuery(query)) {
    const [chapter, target] = extractChapterFromNcm(part);
    if (!chapter || chapterTargets.has(chapter)) continue;
    chapterTargets.set(chapter, [part, target]);
    if (chapterTargets.size >= MULTI_CODE_MAX_PARTS) break;
  }

  return chapterTargets;
}

function isLegacyNeshChapterSchemaError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /no such column|rendered_html|schema/i.test(message);
}

function getNeshChapterSearchData(chapterNum) {
  let chapterData;

  try {
    chapterData = queryFirstOptionalRow(
      `SELECT c.content, c.rendered_html,
              n.notes_content, n.titulo, n.notas,
              n.consideracoes, n.definicoes, n.parsed_notes_json
       FROM nesh_chapters c
       LEFT JOIN nesh_chapter_notes n ON n.chapter_num = c.chapter_num
       WHERE c.chapter_num = ?`,
      [chapterNum]
    );
  } catch (error) {
    if (!isLegacyNeshChapterSchemaError(error)) {
      throw error;
    }

    chapterData = queryFirstOptionalRow(
      `SELECT c.content, NULL AS rendered_html,
              n.notes_content, n.titulo, n.notas,
              n.consideracoes, n.definicoes, n.parsed_notes_json
       FROM nesh_chapters c
       LEFT JOIN nesh_chapter_notes n ON n.chapter_num = c.chapter_num
       WHERE c.chapter_num = ?`,
      [chapterNum]
    );
  }

  return {
    positions: queryResultRows(
      `SELECT codigo, descricao FROM nesh_positions WHERE chapter_num = ? ORDER BY codigo`,
      [chapterNum]
    ),
    chapterData: chapterData
      ? {
          content: chapterData.content,
          rendered_html: chapterData.rendered_html,
        }
      : null,
    notesData: chapterData
      ? {
          notes_content: chapterData.notes_content,
          titulo: chapterData.titulo,
          notas: chapterData.notas,
          consideracoes: chapterData.consideracoes,
          definicoes: chapterData.definicoes,
          parsed_notes_json: chapterData.parsed_notes_json,
        }
      : null,
  };
}

function buildOfflineNeshMarkup(results, chapterHtmlByChapter) {
  const orderedChapters = Object.keys(results).sort(
    (left, right) => Number(left) - Number(right)
  );
  const htmlParts = [];

  for (const chapterNum of orderedChapters) {
    const chapterHtml = chapterHtmlByChapter[chapterNum];
    if (typeof chapterHtml === "string" && chapterHtml.trim()) {
      htmlParts.push(chapterHtml.trim());
    }
  }

  return htmlParts.join("\n\n");
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

export function searchTipiByCode(query, viewMode = "family") {
  if (!getWorkerDb()) {
    return { type: "code", results: {}, total: 0, total_capitulos: 0 };
  }

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
    (sum, chapter) => sum + (chapter.posicoes?.length || 0),
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

export function searchNeshByCode(query) {
  if (!getWorkerDb()) {
    return {
      type: "code",
      results: {},
      total_capitulos: 0,
      success: true,
      markdown: "",
    };
  }

  const chapterTargets = collectNeshChapterTargets(query);
  if (chapterTargets.size === 0) {
    return {
      type: "code",
      query,
      normalized: null,
      results: {},
      total_capitulos: 0,
      success: true,
      markdown: "",
    };
  }

  /** @type {Record<string, any>} */
  const results = {};
  /** @type {Record<string, string>} */
  const renderedHtmlByChapter = {};

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

    if (typeof chapterData?.rendered_html === "string") {
      renderedHtmlByChapter[chapterNum] = chapterData.rendered_html;
    }
  }

  return {
    type: "code",
    query,
    normalized: null,
    results,
    total_capitulos: Object.keys(results).length,
    success: true,
    markdown: buildOfflineNeshMarkup(results, renderedHtmlByChapter),
  };
}
