import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLocalNbsDetail } from '../../src/workers/dbWorker/catalogSearch.js';
import { setWorkerDb } from '../../src/workers/dbWorker/state.js';

describe('dbWorker catalogSearch', () => {
  afterEach(() => {
    setWorkerDb(null);
  });

  it('loads inline NBS explanatory notes only from trusted NEBS rows', () => {
    let nebsSql = '';
    const item = {
      code: '1.0101.11.00',
      code_clean: '10101100',
      description: 'Serviços residenciais',
      parent_code: null,
      level: 3,
    };
    const db = {
      exec: vi.fn((sql: string) => {
        if (sql.includes('FROM nebs_entries')) {
          nebsSql = sql;
          return [
            {
              code: '1.0101.11.00',
              code_clean: '10101100',
              title: 'Nota confiável',
              body_text: 'Conteudo confiavel',
              body_markdown: 'Conteudo confiavel',
              section_title: 'SEÇÃO I',
              page_start: 1,
              page_end: 2,
            },
          ];
        }
        if (sql.includes('COUNT(*) AS total')) {
          return [{ total: 1 }];
        }
        if (sql.includes('WHERE parent_code = ?')) {
          return [];
        }
        if (sql.includes('WHERE code = ?') && sql.includes('OR code LIKE ?')) {
          return [item];
        }
        if (sql.includes('FROM nbs_items')) {
          return [item];
        }
        return [];
      }),
    };
    setWorkerDb(db);

    const detail = getLocalNbsDetail('1.0101.11.00');

    expect(detail?.nebs?.title).toBe('Nota confiável');
    expect(nebsSql).toContain("parser_status = 'trusted'");
  });
});
