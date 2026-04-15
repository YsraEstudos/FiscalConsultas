/**
 * Worker Utility Functions — Pure, testable helpers for offline search.
 *
 * These functions are ports of the Python backend utilities into JavaScript.
 * They MUST stay in sync with:
 *   - backend/utils/ncm_utils.py
 *   - backend/utils/id_utils.py
 *   - client/src/utils/id_utils.ts
 *
 * @module workerUtils
 */

// ---------------------------------------------------------------------------
// NCM Utilities (ports of ncm_utils.py)
// ---------------------------------------------------------------------------

/**
 * Remove all non-numeric characters from a string.
 * Port of: ncm_utils.clean_ncm()
 * @param {string} ncm
 * @returns {string}
 */
export function cleanNcm(ncm) {
  return (ncm || "").replace(/[^0-9]/g, "");
}

/**
 * Check if a query is composed only of code-like characters (digits, dots, commas, dashes, spaces).
 * Port of: ncm_utils.is_code_query()
 * @param {string} query
 * @returns {boolean}
 */
export function isCodeQuery(query) {
  const q = (query || "").trim();
  if (!q) return false;
  return /^[0-9.,-\s]+$/.test(q);
}

/**
 * Format an NCM code to the TIPI standard (with dots).
 * Port of: ncm_utils.format_ncm_tipi()
 * @param {string} ncm
 * @returns {string}
 */
export function formatNcmTipi(ncm) {
  const digits = cleanNcm(ncm);
  if (!digits) return (ncm || "").trim();

  if (digits.length === 8)
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
  if (digits.length === 7)
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
  if (digits.length === 6)
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}`;
  if (digits.length === 5)
    return `${digits.slice(0, 4)}.${digits.slice(4)}`;
  if (digits.length === 4)
    return `${digits.slice(0, 2)}.${digits.slice(2, 4)}`;
  if (digits.length === 2) return digits;
  return digits;
}

/**
 * Generate an anchor ID for HTML elements from an NCM code.
 * Port of: id_utils.generate_anchor_id() (Python + TS)
 * @param {string} ncmCode
 * @returns {string}
 */
export function generateAnchorId(ncmCode) {
  const rawCode = String(ncmCode || "").trim();
  if (!rawCode) return "";

  const candidate = rawCode.startsWith("pos-") ? rawCode.slice(4) : rawCode;
  const safeChars = candidate.replace(/[^a-zA-Z0-9.-]/g, "");
  const cleanCode = safeChars.replace(/\./g, "-");

  return cleanCode ? `pos-${cleanCode}` : "";
}

/**
 * Extract chapter number and target position from an NCM code.
 * Port of: ncm_utils.extract_chapter_from_ncm()
 * @param {string} ncm
 * @returns {[string|null, string|null]} [chapter, target_position]
 */
export function extractChapterFromNcm(ncm) {
  const raw = (ncm || "").trim();
  const compact = raw.replace(/\s+/g, "");

  // Preserve short subposition like 8419.8 or 8419.80
  if (/^\d{4}\.\d{1,2}$/.test(compact)) {
    const chapter = compact.slice(0, 2).padStart(2, "0");
    return [chapter, compact];
  }

  const digits = cleanNcm(ncm);
  if (!digits) return [null, null];

  let chapter = null;
  let target = null;

  if (digits.length >= 2) {
    chapter = digits.slice(0, 2).padStart(2, "0");
  } else if (digits.length === 1) {
    chapter = digits.padStart(2, "0");
  }

  if (digits.length >= 4) {
    target = `${digits.slice(0, 2)}.${digits.slice(2, 4)}`;
  }

  return [chapter, target];
}

/**
 * Split a multi-NCM query into individual parts.
 * Port of: ncm_utils.split_ncm_query()
 * @param {string} query
 * @returns {string[]}
 */
export function splitNcmQuery(query) {
  const parts = (query || "").split(/[;,\s]+/).map((p) => p.trim());
  return parts.filter((p) => p.length > 0);
}

// ---------------------------------------------------------------------------
// Hierarchy Builders (ports of service logic)
// ---------------------------------------------------------------------------

/**
 * Build ancestor prefixes for family view filtering.
 * Port of: TipiService._build_ancestor_prefixes()
 * @param {string} prefix
 * @returns {Set<string>}
 */
export function buildAncestorPrefixes(prefix) {
  const ancestors = new Set();
  if (prefix.length >= 4) ancestors.add(prefix.slice(0, 4));
  if (prefix.length >= 6) ancestors.add(prefix.slice(0, 6));
  return ancestors;
}

/**
 * Build TIPI code search hierarchy from flat database rows.
 *
 * Replicates TipiService.search_by_code / _build_code_resultados.
 *
 * @param {Array<Record<string, any>>} rows - Flat rows from SQLite
 * @param {string} query - Original user query
 * @param {string} posicaoAlvo - Target position for auto-scroll
 * @returns {Record<string, any>} Chapter-grouped results
 */
export function buildTipiHierarchy(rows, query, posicaoAlvo) {
  /** @type {Record<string, any>} */
  const resultados = {};

  for (const row of rows) {
    const cap = row.capitulo || "";
    if (!resultados[cap]) {
      resultados[cap] = {
        capitulo: cap,
        titulo: `Capítulo ${cap}`,
        notas_gerais: null,
        posicao_alvo: null,
        posicoes: [],
      };
    }

    // Resolve posicao_alvo per chapter
    if (posicaoAlvo) {
      const cleanAlvo = cleanNcm(posicaoAlvo);
      if (cleanAlvo.startsWith(cap)) {
        resultados[cap].posicao_alvo = posicaoAlvo;
      }
    }

    const codigo = row.ncm || "";
    resultados[cap].posicoes.push({
      ncm: codigo,
      codigo: codigo,
      descricao: row.descricao || "",
      aliquota: row.aliquota || "0",
      nivel: row.nivel || 0,
      anchor_id: generateAnchorId(codigo),
    });
  }

  return resultados;
}

/**
 * Build NESH code search hierarchy from database data.
 *
 * Replicates NeshService.search_by_code / _build_found_chapter_search_result.
 *
 * @param {string} chapterNum - Chapter number
 * @param {string} ncmBuscado - Original NCM searched
 * @param {string|null} targetPos - Target position for auto-scroll
 * @param {Array<Record<string, any>>} positions - Position rows
 * @param {{ content: string } | null} chapterData - Chapter content
 * @param {Record<string, any> | null} notesData - Chapter notes
 * @returns {Record<string, any>} Chapter result
 */
export function buildNeshChapterResult(
  chapterNum,
  ncmBuscado,
  targetPos,
  positions,
  chapterData,
  notesData
) {
  // Build parsed_notes from JSON if available
  let parsedNotes = {};
  if (notesData?.parsed_notes_json) {
    try {
      parsedNotes = JSON.parse(notesData.parsed_notes_json);
    } catch {
      parsedNotes = {};
    }
  }

  // Build sections from notes data
  let secoes = null;
  if (notesData) {
    const hasSections = [
      notesData.titulo,
      notesData.notas,
      notesData.consideracoes,
      notesData.definicoes,
    ].some((v) => (v || "").trim());

    if (hasSections) {
      secoes = {
        titulo: notesData.titulo || null,
        notas: notesData.notas || null,
        consideracoes: notesData.consideracoes || null,
        definicoes: notesData.definicoes || null,
      };
    }
  }

  return {
    ncm_buscado: ncmBuscado,
    capitulo: chapterNum,
    posicao_alvo: targetPos,
    posicoes: positions.map((pos) => ({
      codigo: pos.codigo || "",
      descricao: pos.descricao || "",
      anchor_id: generateAnchorId(pos.codigo || ""),
    })),
    notas_gerais: notesData?.notes_content || null,
    notas_parseadas: parsedNotes,
    conteudo: chapterData?.content || "",
    real_content_found: !!(chapterData?.content),
    erro: null,
    secoes: secoes,
  };
}

/**
 * Prefer the more specific posicao_alvo between two candidates.
 * Port of: TipiService._prefer_more_specific_posicao_alvo()
 * @param {string|null} current
 * @param {string|null} incoming
 * @returns {string|null}
 */
export function preferMoreSpecific(current, incoming) {
  if (!incoming) return current;
  if (!current) return incoming;
  const currentClean = cleanNcm(current);
  const incomingClean = cleanNcm(incoming);
  return incomingClean.length > currentClean.length ? incoming : current;
}
