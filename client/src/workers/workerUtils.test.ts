/**
 * Tests for workerUtils.js — Pure functions for offline search.
 *
 * These tests validate that the JavaScript ports of Python backend
 * utilities (ncm_utils.py, id_utils.py) produce identical results.
 */
import { describe, it, expect } from "vitest";
import {
  isCodeQuery,
  cleanNcm,
  formatNcmTipi,
  generateAnchorId,
  extractChapterFromNcm,
  splitNcmQuery,
  buildAncestorPrefixes,
  buildTipiHierarchy,
  buildNeshChapterResult,
  preferMoreSpecific,
  escapeLikePattern,
} from "./workerUtils.js";

// ---------------------------------------------------------------------------
// isCodeQuery
// ---------------------------------------------------------------------------
describe("isCodeQuery", () => {
  it("detects numeric code", () => {
    expect(isCodeQuery("8413")).toBe(true);
  });

  it("detects code with dots", () => {
    expect(isCodeQuery("8413.91.90")).toBe(true);
  });

  it("detects multi-code with comma", () => {
    expect(isCodeQuery("8413, 8517")).toBe(true);
  });

  it("rejects text query", () => {
    expect(isCodeQuery("bomba hidráulica")).toBe(false);
  });

  it("rejects mixed text and numbers", () => {
    expect(isCodeQuery("bomba 8413")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isCodeQuery("")).toBe(false);
  });

  it("rejects null/undefined", () => {
    expect(isCodeQuery(null)).toBe(false);
    expect(isCodeQuery(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cleanNcm
// ---------------------------------------------------------------------------
describe("cleanNcm", () => {
  it("removes dots and dashes", () => {
    expect(cleanNcm("84.13.91")).toBe("841391");
  });

  it("returns empty for empty input", () => {
    expect(cleanNcm("")).toBe("");
  });

  it("handles null", () => {
    expect(cleanNcm(null)).toBe("");
  });

  it("keeps only digits", () => {
    expect(cleanNcm("abc123def")).toBe("123");
  });
});

// ---------------------------------------------------------------------------
// formatNcmTipi
// ---------------------------------------------------------------------------
describe("formatNcmTipi", () => {
  it("formats 8 digits", () => {
    expect(formatNcmTipi("84139190")).toBe("8413.91.90");
  });

  it("formats 6 digits", () => {
    expect(formatNcmTipi("841311")).toBe("8413.11");
  });

  it("formats 4 digits", () => {
    expect(formatNcmTipi("8413")).toBe("84.13");
  });

  it("formats 2 digits", () => {
    expect(formatNcmTipi("84")).toBe("84");
  });

  it("handles already formatted", () => {
    expect(formatNcmTipi("84.13")).toBe("84.13");
  });

  it("handles empty", () => {
    expect(formatNcmTipi("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// generateAnchorId
// ---------------------------------------------------------------------------
describe("generateAnchorId", () => {
  it("generates anchor from dotted NCM", () => {
    expect(generateAnchorId("85.17")).toBe("pos-85-17");
  });

  it("generates anchor from plain NCM", () => {
    expect(generateAnchorId("8517")).toBe("pos-8517");
  });

  it("generates anchor from full NCM", () => {
    expect(generateAnchorId("8517.10.00")).toBe("pos-8517-10-00");
  });

  it("is idempotent", () => {
    expect(generateAnchorId("pos-85-17")).toBe("pos-85-17");
  });

  it("re-sanitizes prefixed values instead of trusting them blindly", () => {
    expect(generateAnchorId("pos-85-17<script>")).toBe("pos-85-17script");
  });

  it("returns empty for falsy input", () => {
    expect(generateAnchorId("")).toBe("");
    expect(generateAnchorId(null)).toBe("");
    expect(generateAnchorId(undefined)).toBe("");
  });

  it("strips unsafe characters", () => {
    // Regex keeps a-zA-Z0-9.- — so <> are stripped but "script" letters stay
    expect(generateAnchorId("85<script>17")).toBe("pos-85script17");
    // True injection: special chars removed
    expect(generateAnchorId("85&17")).toBe("pos-8517");
  });
});

// ---------------------------------------------------------------------------
// escapeLikePattern
// ---------------------------------------------------------------------------
describe("escapeLikePattern", () => {
  it("escapes SQL LIKE wildcards and backslashes", () => {
    expect(escapeLikePattern("1_23%45\\67")).toBe("1\\_23\\%45\\\\67");
  });

  it("leaves plain prefixes unchanged", () => {
    expect(escapeLikePattern("8413")).toBe("8413");
  });
});

// ---------------------------------------------------------------------------
// extractChapterFromNcm
// ---------------------------------------------------------------------------
describe("extractChapterFromNcm", () => {
  it("extracts chapter and target from full NCM", () => {
    expect(extractChapterFromNcm("8413.91.90")).toEqual(["84", "84.13"]);
  });

  it("extracts chapter only from 2-digit code", () => {
    expect(extractChapterFromNcm("84")).toEqual(["84", null]);
  });

  it("extracts chapter from 4-digit code", () => {
    expect(extractChapterFromNcm("7315")).toEqual(["73", "73.15"]);
  });

  it("preserves short subposition", () => {
    expect(extractChapterFromNcm("8419.8")).toEqual(["84", "8419.8"]);
  });

  it("preserves 2-digit subposition", () => {
    expect(extractChapterFromNcm("8419.80")).toEqual(["84", "8419.80"]);
  });

  it("returns [null, null] for empty", () => {
    expect(extractChapterFromNcm("")).toEqual([null, null]);
  });

  it("pads single digit to 2", () => {
    expect(extractChapterFromNcm("1")).toEqual(["01", null]);
  });
});

// ---------------------------------------------------------------------------
// splitNcmQuery
// ---------------------------------------------------------------------------
describe("splitNcmQuery", () => {
  it("splits by comma", () => {
    expect(splitNcmQuery("8413, 8517")).toEqual(["8413", "8517"]);
  });

  it("splits by space", () => {
    expect(splitNcmQuery("8413 8517")).toEqual(["8413", "8517"]);
  });

  it("splits by semicolon", () => {
    expect(splitNcmQuery("8413;8517")).toEqual(["8413", "8517"]);
  });

  it("handles single NCM", () => {
    expect(splitNcmQuery("8413")).toEqual(["8413"]);
  });

  it("filters empty parts", () => {
    expect(splitNcmQuery("8413,,8517")).toEqual(["8413", "8517"]);
  });

  it("returns empty for empty input", () => {
    expect(splitNcmQuery("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildAncestorPrefixes
// ---------------------------------------------------------------------------
describe("buildAncestorPrefixes", () => {
  it("builds ancestors for 6+ digit prefix", () => {
    const ancestors = buildAncestorPrefixes("841391");
    expect(ancestors).toEqual(new Set(["8413", "841391"]));
  });

  it("builds single ancestor for 4-digit prefix", () => {
    const ancestors = buildAncestorPrefixes("8413");
    expect(ancestors).toEqual(new Set(["8413"]));
  });

  it("returns empty for short prefix", () => {
    const ancestors = buildAncestorPrefixes("84");
    expect(ancestors.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildTipiHierarchy
// ---------------------------------------------------------------------------
describe("buildTipiHierarchy", () => {
  const mockRows = [
    { ncm: "84.13", capitulo: "84", descricao: "Bombas", aliquota: "10", nivel: 1 },
    { ncm: "8413.91", capitulo: "84", descricao: "De bombas", aliquota: "10", nivel: 2 },
    { ncm: "8413.91.90", capitulo: "84", descricao: "Outras", aliquota: "10", nivel: 3 },
  ];

  it("groups rows by chapter", () => {
    const result = buildTipiHierarchy(mockRows, "8413", "84.13");
    expect(Object.keys(result)).toEqual(["84"]);
    expect(result["84"].posicoes).toHaveLength(3);
  });

  it("includes anchor_id on each position", () => {
    const result = buildTipiHierarchy(mockRows, "8413", "84.13");
    expect(result["84"].posicoes[0].anchor_id).toBe("pos-84-13");
    expect(result["84"].posicoes[2].anchor_id).toBe("pos-8413-91-90");
  });

  it("sets posicao_alvo when target matches chapter", () => {
    const result = buildTipiHierarchy(mockRows, "8413", "84.13");
    expect(result["84"].posicao_alvo).toBe("84.13");
  });

  it("returns empty for no rows", () => {
    const result = buildTipiHierarchy([], "8413", null);
    expect(Object.keys(result)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildNeshChapterResult
// ---------------------------------------------------------------------------
describe("buildNeshChapterResult", () => {
  const positions = [
    { codigo: "73.15", descricao: "Correntes" },
    { codigo: "73.15.11", descricao: "Correntes de rolos" },
  ];

  it("builds chapter result with content", () => {
    const result = buildNeshChapterResult(
      "73", "7315", "73.15",
      positions,
      { content: "<h1>Capítulo 73</h1>" },
      { notes_content: "Notas gerais", parsed_notes_json: '{"73.01":"nota"}', titulo: "Obras de ferro", notas: null, consideracoes: null, definicoes: null }
    );
    expect(result.capitulo).toBe("73");
    expect(result.conteudo).toBe("<h1>Capítulo 73</h1>");
    expect(result.notas_gerais).toBe("Notas gerais");
    expect(result.notas_parseadas).toEqual({ "73.01": "nota" });
    expect(result.real_content_found).toBe(true);
    expect(result.posicoes).toHaveLength(2);
    expect(result.posicoes[0].anchor_id).toBe("pos-73-15");
  });

  it("handles missing content gracefully", () => {
    const result = buildNeshChapterResult("73", "7315", null, positions, null, null);
    expect(result.conteudo).toBe("");
    expect(result.real_content_found).toBe(false);
    expect(result.notas_gerais).toBeNull();
    expect(result.notas_parseadas).toEqual({});
    expect(result.secoes).toBeNull();
  });

  it("builds sections when they exist", () => {
    const result = buildNeshChapterResult("73", "7315", null, positions, null, {
      notes_content: null, parsed_notes_json: null,
      titulo: "Obras de ferro", notas: "Notas do capítulo",
      consideracoes: null, definicoes: null,
    });
    expect(result.secoes).toEqual({
      titulo: "Obras de ferro",
      notas: "Notas do capítulo",
      consideracoes: null,
      definicoes: null,
    });
  });
});

// ---------------------------------------------------------------------------
// preferMoreSpecific
// ---------------------------------------------------------------------------
describe("preferMoreSpecific", () => {
  it("prefers longer (more specific) NCM", () => {
    expect(preferMoreSpecific("84.13", "8413.91")).toBe("8413.91");
  });

  it("keeps current when incoming is shorter", () => {
    expect(preferMoreSpecific("8413.91", "84.13")).toBe("8413.91");
  });

  it("returns incoming when current is null", () => {
    expect(preferMoreSpecific(null, "84.13")).toBe("84.13");
  });

  it("returns current when incoming is null", () => {
    expect(preferMoreSpecific("84.13", null)).toBe("84.13");
  });

  it("returns null when both are null", () => {
    expect(preferMoreSpecific(null, null)).toBeNull();
  });
});
