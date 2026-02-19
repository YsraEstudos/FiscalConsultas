import { describe, it, expect } from 'vitest';
import { formatNcmTipi, generateAnchorId, generateChapterId, normalizeNCMQuery } from '../../src/utils/id_utils';

describe('generateAnchorId', () => {
    it('should generate "pos-{code}" replacing dots with dashes', () => {
        expect(generateAnchorId('85.17')).toBe('pos-85-17');
    });

    it('should handle code without dots', () => {
        expect(generateAnchorId('8517')).toBe('pos-8517');
    });

    it('should handle complex code with multiple dots', () => {
        expect(generateAnchorId('8517.10.00')).toBe('pos-8517-10-00');
    });

    it('should remove unsafe characters', () => {
        expect(generateAnchorId('85.17@!')).toBe('pos-85-17');
    });

    it('should handle empty input', () => {
        expect(generateAnchorId('')).toBe('');
        expect(generateAnchorId(null)).toBe('');
        expect(generateAnchorId(undefined)).toBe('');
    });

    it('should be idempotent for values already prefixed with pos-', () => {
        expect(generateAnchorId('pos-84-13')).toBe('pos-84-13');
    });
});

describe('normalizeNCMQuery', () => {
    it('should convert 4-digit code to XX.XX format', () => {
        expect(normalizeNCMQuery('8417')).toBe('84.17');
        expect(normalizeNCMQuery('4908')).toBe('49.08');
        expect(normalizeNCMQuery('0101')).toBe('01.01');
    });

    it('should extract first 4 digits from full NCM codes', () => {
        expect(normalizeNCMQuery('4908.90.00')).toBe('49.08');
        expect(normalizeNCMQuery('49089000')).toBe('49.08');
        expect(normalizeNCMQuery('8517.10.00')).toBe('85.17');
    });

    it('should return 2-digit codes as-is for chapters', () => {
        expect(normalizeNCMQuery('84')).toBe('84');
        expect(normalizeNCMQuery('01')).toBe('01');
    });

    it('should handle empty/null input', () => {
        expect(normalizeNCMQuery('')).toBe('');
        expect(normalizeNCMQuery(null)).toBe('');
        expect(normalizeNCMQuery(undefined)).toBe('');
    });

    it('should fallback to trimmed original query when digits are not chapter/position length', () => {
        expect(normalizeNCMQuery('  a1b  ')).toBe('a1b');
        expect(normalizeNCMQuery('abc')).toBe('abc');
    });
});

describe('generateChapterId', () => {
    it('should use chapter- prefix for raw chapter numbers', () => {
        expect(generateChapterId('84')).toBe('chapter-84');
        expect(generateChapterId(73)).toBe('chapter-73');
    });

    it('should be idempotent for chapter- ids', () => {
        expect(generateChapterId('chapter-84')).toBe('chapter-84');
    });

    it('should normalize legacy cap- ids to chapter-', () => {
        expect(generateChapterId('cap-84')).toBe('chapter-84');
    });

    it('should return chapter- for empty-like values', () => {
        expect(generateChapterId('')).toBe('chapter-');
        expect(generateChapterId('   ')).toBe('chapter-');
    });
});

describe('formatNcmTipi', () => {
    it('formats by length from 8 to 2 digits', () => {
        expect(formatNcmTipi('84139190')).toBe('8413.91.90');
        expect(formatNcmTipi('8413919')).toBe('8413.91.9');
        expect(formatNcmTipi('841391')).toBe('8413.91');
        expect(formatNcmTipi('84139')).toBe('8413.9');
        expect(formatNcmTipi('8404')).toBe('84.04');
        expect(formatNcmTipi('84')).toBe('84');
    });

    it('keeps only digits for uncommon lengths', () => {
        expect(formatNcmTipi('123')).toBe('123');
        expect(formatNcmTipi('123456789')).toBe('123456789');
    });

    it('handles nullish and non-numeric input', () => {
        expect(formatNcmTipi('')).toBe('');
        expect(formatNcmTipi(null)).toBe('');
        expect(formatNcmTipi(undefined)).toBe('');
        expect(formatNcmTipi('abc')).toBe('abc');
        expect(formatNcmTipi('  abc  ')).toBe('abc');
    });
});
