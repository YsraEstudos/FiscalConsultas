import { describe, it, expect } from 'vitest';
import { extractChapter, isSameChapter } from '../../src/utils/chapterDetection';

describe('chapterDetection', () => {
    describe('extractChapter', () => {
        it('should extract chapter from dotted NCM (XX.XX format)', () => {
            expect(extractChapter('84.22')).toBe('84');
            expect(extractChapter('73.08')).toBe('73');
            expect(extractChapter('01.01')).toBe('01');
        });

        it('should extract chapter from subposition (XXXX.XX format)', () => {
            expect(extractChapter('8422.10')).toBe('84');
            expect(extractChapter('7308.10')).toBe('73');
        });

        it('should extract chapter from full NCM (XXXX.XX.XX format)', () => {
            expect(extractChapter('8422.10.00')).toBe('84');
            expect(extractChapter('7308.10.00')).toBe('73');
        });

        it('should extract chapter from raw digits (no dots)', () => {
            expect(extractChapter('8422')).toBe('84');
            expect(extractChapter('842210')).toBe('84');
            expect(extractChapter('84221000')).toBe('84');
        });

        it('should handle edge cases', () => {
            expect(extractChapter('')).toBe(null);
            expect(extractChapter('invalid')).toBe(null);
            expect(extractChapter('1')).toBe(null); // Only 1 digit
            expect(extractChapter('12')).toBe('12'); // Valid 2-digit chapter
        });

        it('should handle null/undefined gracefully', () => {
            expect(extractChapter(null)).toBe(null);
            expect(extractChapter(undefined)).toBe(null);
        });
    });

    describe('isSameChapter', () => {
        it('should return true when NCM belongs to loaded chapter', () => {
            expect(isSameChapter('8422.1', ['84', '73'])).toBe(true);
            expect(isSameChapter('84.22', ['84'])).toBe(true);
            expect(isSameChapter('842210', ['84', '94'])).toBe(true);
        });

        it('should return false when NCM does not belong to loaded chapters', () => {
            expect(isSameChapter('9401', ['84', '73'])).toBe(false);
            expect(isSameChapter('01.01', ['84', '73'])).toBe(false);
        });

        it('should return false for invalid NCM', () => {
            expect(isSameChapter('', ['84'])).toBe(false);
            expect(isSameChapter('invalid', ['84'])).toBe(false);
        });

        it('should return false for empty loadedChapters', () => {
            expect(isSameChapter('8422.1', [])).toBe(false);
        });

        it('should handle null/undefined gracefully', () => {
            expect(isSameChapter(null, ['84'])).toBe(false);
            expect(isSameChapter('8422', null)).toBe(false);
        });
    });
});
