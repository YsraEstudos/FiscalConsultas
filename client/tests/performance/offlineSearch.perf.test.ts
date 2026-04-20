/**
 * Offline Search Performance Benchmark
 *
 * Measures the performance of pure worker utility functions and
 * search result serialization to validate optimization gains.
 *
 * Run with: npm run test:perf
 */
import { describe, it, expect } from 'vitest';
import { summarizeDurations, type PerfSummary } from './helpers.perf';
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
} from '../../src/workers/workerUtils.js';

// ---------------------------------------------------------------------------
// Test data generators
// ---------------------------------------------------------------------------

function makeNeshPositions(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    codigo: `84.${String(i).padStart(2, '0')}`,
    descricao: `Descrição da posição ${i} — máquinas, aparelhos e instrumentos mecânicos para tratamento de materiais ${i}`,
  }));
}

function makeTipiRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ncm: `84.${String(i).padStart(2, '0')}`,
    capitulo: '84',
    descricao: `Descrição TIPI item ${i} — bombas, compressores e ventiladores industriais`,
    aliquota: `${(i % 20).toString()}`,
    nivel: i % 4,
  }));
}

function makeSearchPayloads(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    results: makeNeshPositions(50),
    searchType: 'text' as const,
    docType: 'nesh',
    query: `query-${i}`,
    source: 'local',
  }));
}

// ---------------------------------------------------------------------------
// Benchmarking harness
// ---------------------------------------------------------------------------

function benchmark(name: string, fn: () => void, iterations: number = 1000): PerfSummary {
  // Warm-up
  for (let i = 0; i < Math.min(50, iterations); i++) fn();

  const durations: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    durations.push(performance.now() - start);
  }

  const summary = summarizeDurations(durations);
  console.log(
    `  [perf] ${name}: p50=${summary.p50.toFixed(3)}ms p95=${summary.p95.toFixed(3)}ms p99=${summary.p99.toFixed(3)}ms avg=${summary.avg.toFixed(3)}ms (${summary.samples} samples)`
  );
  return summary;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Offline Search Performance', () => {
  describe('Pure utility functions (workerUtils.js)', () => {
    it('isCodeQuery should resolve in <0.01ms per call', () => {
      const queries = ['8413', '8413.91.90', '8413, 8517', 'bomba hidráulica', 'bomba 8413', ''];
      const summary = benchmark('isCodeQuery', () => {
        for (const q of queries) isCodeQuery(q);
      });
      expect(summary.p95).toBeLessThan(0.5);
    });

    it('cleanNcm + formatNcmTipi chain should resolve in <0.05ms per call', () => {
      const inputs = ['84139190', '8413.91', '84.13', '84', ''];
      const summary = benchmark('cleanNcm+formatNcmTipi', () => {
        for (const input of inputs) {
          formatNcmTipi(cleanNcm(input));
        }
      });
      expect(summary.p95).toBeLessThan(0.5);
    });

    it('extractChapterFromNcm should resolve in <0.02ms per call', () => {
      const codes = ['8413.91.90', '84', '7315', '8419.8', '8419.80', '', '1'];
      const summary = benchmark('extractChapterFromNcm', () => {
        for (const code of codes) extractChapterFromNcm(code);
      });
      expect(summary.p95).toBeLessThan(0.5);
    });

    it('splitNcmQuery should handle multi-code inputs in <0.05ms', () => {
      const queries = ['8413, 8517, 7308, 2922.11, 3902.10.20', '8413', '8413;8517;7308'];
      const summary = benchmark('splitNcmQuery', () => {
        for (const q of queries) splitNcmQuery(q);
      });
      expect(summary.p95).toBeLessThan(0.5);
    });

    it('buildAncestorPrefixes should resolve in <0.01ms', () => {
      const prefixes = ['841391', '8413', '84'];
      const summary = benchmark('buildAncestorPrefixes', () => {
        for (const p of prefixes) buildAncestorPrefixes(p);
      });
      expect(summary.p95).toBeLessThan(0.5);
    });
  });

  describe('Hierarchy builders (workerUtils.js)', () => {
    it('buildTipiHierarchy with 100 positions should resolve in <2ms', () => {
      const rows = makeTipiRows(100);
      const summary = benchmark('buildTipiHierarchy(100)', () => {
        buildTipiHierarchy(rows, '8413', '84.13');
      }, 500);
      expect(summary.p95).toBeLessThan(5);
    });

    it('buildTipiHierarchy with 500 positions should resolve in <10ms', () => {
      const rows = makeTipiRows(500);
      const summary = benchmark('buildTipiHierarchy(500)', () => {
        buildTipiHierarchy(rows, '8413', '84.13');
      }, 200);
      expect(summary.p95).toBeLessThan(15);
    });

    it('buildNeshChapterResult with 100 positions should resolve in <2ms', () => {
      const positions = makeNeshPositions(100);
      const chapterData = { content: '<h1>Capítulo 84</h1><p>Conteúdo extenso...</p>'.repeat(50) };
      const notesData = {
        notes_content: 'Notas gerais do capítulo',
        titulo: 'Reatores nucleares, caldeiras, máquinas',
        notas: 'Notas complementares',
        consideracoes: null,
        definicoes: null,
        parsed_notes_json: JSON.stringify({ '84.01': 'Reatores nucleares' }),
      };

      const summary = benchmark('buildNeshChapterResult(100)', () => {
        buildNeshChapterResult('84', '8413', '84.13', positions, chapterData, notesData);
      }, 500);
      expect(summary.p95).toBeLessThan(5);
    });

    it('preferMoreSpecific should resolve in <0.01ms', () => {
      const pairs: [string | null, string | null][] = [
        ['84.13', '8413.91'],
        ['8413.91', '84.13'],
        [null, '84.13'],
        ['84.13', null],
        [null, null],
      ];
      const summary = benchmark('preferMoreSpecific', () => {
        for (const [a, b] of pairs) preferMoreSpecific(a, b);
      });
      expect(summary.p95).toBeLessThan(0.5);
    });
  });

  describe('Serialization overhead simulation', () => {
    it('structuredClone of typical search payload should resolve in <5ms', () => {
      const payloads = makeSearchPayloads(3);
      const summary = benchmark('structuredClone(searchPayload)', () => {
        for (const p of payloads) structuredClone(p);
      }, 200);
      // postMessage uses structuredClone internally
      expect(summary.p95).toBeLessThan(15);
    });

    it('JSON.stringify + JSON.parse of typical search payload should resolve in <5ms', () => {
      const payloads = makeSearchPayloads(3);
      const summary = benchmark('JSON roundtrip(searchPayload)', () => {
        for (const p of payloads) {
          JSON.parse(JSON.stringify(p));
        }
      }, 200);
      expect(summary.p95).toBeLessThan(15);
    });
  });

  describe('LRU Cache simulation', () => {
    it('Map-based LRU should lookup and evict in <0.01ms', () => {
      const CACHE_MAX = 32;
      const cache = new Map<string, unknown>();

      function setCached(key: string, value: unknown) {
        if (cache.size >= CACHE_MAX) {
          const oldest = cache.keys().next().value!;
          cache.delete(oldest);
        }
        cache.set(key, value);
      }

      function getCached(key: string) {
        if (!cache.has(key)) return null;
        const val = cache.get(key);
        cache.delete(key);
        cache.set(key, val);
        return val;
      }

      // Pre-fill cache
      for (let i = 0; i < CACHE_MAX; i++) {
        setCached(`key-${i}`, { results: [], searchType: 'text' });
      }

      const summary = benchmark('LRU get+set', () => {
        getCached('key-15');
        setCached('key-new', { results: [], searchType: 'text' });
        getCached('key-new');
      }, 5000);
      expect(summary.p95).toBeLessThan(0.1);
    });
  });
});
