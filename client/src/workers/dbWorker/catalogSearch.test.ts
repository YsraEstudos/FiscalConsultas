import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const exec = vi.fn();
    const db = { exec };

    return { db, exec };
});

vi.mock('./state.js', () => ({
    getWorkerDb: () => mocks.db,
}));

import {
    ftsSearch,
    getLocalNbsDetail,
    searchNbsByCode,
} from './catalogSearch.js';

describe('catalogSearch', () => {
    beforeEach(() => {
        mocks.exec.mockReset();
        mocks.exec.mockReturnValue([]);
    });

    it('escapes wildcard characters in NBS code prefix searches', () => {
        searchNbsByCode('1_2%');

        expect(mocks.exec).toHaveBeenCalledTimes(1);
        const [sql, options] = mocks.exec.mock.calls[0];

        expect(sql).toContain("ESCAPE '\\'");
        expect(options.bind).toEqual([
            '1_2%',
            '1_2%',
            '1\\_2\\%%',
            '12',
            '12',
            '12%',
            '1_2%',
            '12',
            '1\\_2\\%%',
            '12%',
            50,
        ]);
    });

    it('searches all text columns in the FTS fallback', () => {
        mocks.exec
            .mockImplementationOnce(() => {
                throw new Error('fts unavailable');
            })
            .mockReturnValueOnce([]);

        ftsSearch(
            'nbs_fts',
            'limpeza urbana',
            ['code', 'code_clean', 'description', 'parent_code', 'level'],
            'nbs_items',
        );

        expect(mocks.exec).toHaveBeenCalledTimes(2);
        const [sql, options] = mocks.exec.mock.calls[1];

        expect(sql).toContain("code LIKE ? ESCAPE '\\'");
        expect(sql).toContain("description LIKE ? ESCAPE '\\'");
        expect(sql).not.toContain("level LIKE");
        expect(options.bind).toEqual([
            '%limpeza%',
            '%limpeza%',
            '%limpeza%',
            '%limpeza%',
            '%urbana%',
            '%urbana%',
            '%urbana%',
            '%urbana%',
            50,
        ]);
    });

    it('escapes wildcard characters when loading NBS chapter tree pages', () => {
        mocks.exec
            .mockReturnValueOnce([
                {
                    code: '1_2%',
                    code_clean: '12',
                    description: 'root',
                    parent_code: null,
                    level: 1,
                },
            ])
            .mockReturnValueOnce([])
            .mockReturnValueOnce([{ total: 0 }])
            .mockReturnValueOnce([])
            .mockReturnValueOnce([]);

        getLocalNbsDetail('1_2%');

        const [countSql, countOptions] = mocks.exec.mock.calls[2];
        const [itemsSql, itemsOptions] = mocks.exec.mock.calls[3];

        expect(countSql).toContain("code LIKE ? ESCAPE '\\'");
        expect(countOptions.bind).toEqual(['1_2%', '1\\_2\\%%']);
        expect(itemsSql).toContain("code LIKE ? ESCAPE '\\'");
        expect(itemsOptions.bind).toEqual(['1_2%', '1\\_2\\%%', 50, 0]);
    });

    it('loads the explanatory entry inline when loading NBS detail', () => {
        mocks.exec
            .mockReturnValueOnce([
                {
                    code: '1.0201',
                    code_clean: '10201',
                    description: 'service',
                    parent_code: null,
                    level: 2,
                },
            ])
            .mockReturnValueOnce([])
            .mockReturnValueOnce([{ total: 1 }])
            .mockReturnValueOnce([])
            .mockReturnValueOnce([
                {
                    code: '1.0201',
                    code_clean: '10201',
                    title: 'entry',
                    body_text: 'body',
                    body_markdown: 'body',
                    section_title: null,
                    page_start: 1,
                    page_end: 1,
                },
            ]);

        const detail = getLocalNbsDetail(' 1.0201 ');

        expect(mocks.exec.mock.calls[0][1].bind).toEqual([
            '1.0201',
            '1.0201',
            '10201',
            '10201',
        ]);
        expect(mocks.exec.mock.calls[4][1].bind).toEqual(['1.0201', '10201']);
        expect(detail?.nebs).toEqual(expect.objectContaining({
            code: '1.0201',
            body_markdown: 'body',
        }));
    });

    it('trims NBS detail code binds before lookup', () => {
        mocks.exec.mockReturnValueOnce([]);

        getLocalNbsDetail(' 1.0201 ');

        expect(mocks.exec.mock.calls[0][1].bind).toEqual([
            '1.0201',
            '1.0201',
            '10201',
            '10201',
        ]);
    });
});
