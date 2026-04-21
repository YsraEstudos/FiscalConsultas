import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const exec = vi.fn();
    const db = { exec };

    return { db, exec };
});

vi.mock('./state.js', () => ({
    getWorkerDb: () => mocks.db,
}));

import { searchNebsByCode, searchNbsByCode } from './catalogSearch.js';

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

    it('escapes wildcard characters in NEBS code prefix searches', () => {
        searchNebsByCode('1_2%');

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
});
