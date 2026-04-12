import { describe, expect, it } from 'vitest';
import {
    getNbsChapterNotesCatalog,
    getNbsChapterNotesEntry,
    getNbsChapterNumber,
} from './nbsChapterNotes';

describe('nbsChapterNotes', () => {
    it('extracts the chapter number from NBS codes', () => {
        expect(getNbsChapterNumber('1.0602.22.00')).toBe('06');
        expect(getNbsChapterNumber('1.1703')).toBe('17');
        expect(getNbsChapterNumber('101022290')).toBe('01');
        expect(getNbsChapterNumber('texto livre')).toBeNull();
    });

    it('loads the official notes catalog for all chapters', () => {
        const catalog = getNbsChapterNotesCatalog();

        expect(Object.keys(catalog)).toHaveLength(26);
        expect(catalog['06']?.title).toContain('apoio aos transportes');
        expect(catalog['16']?.hasOfficialNotes).toBe(false);
    });

    it('returns chapter notes using the active NBS code', () => {
        const chapter = getNbsChapterNotesEntry('1.0601');

        expect(chapter?.chapter).toBe('06');
        expect(chapter?.notes[0]?.text).toContain('armazenagem em depósitos');
    });
});
