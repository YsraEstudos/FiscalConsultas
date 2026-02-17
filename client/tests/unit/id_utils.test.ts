import { describe, it, expect } from 'vitest';
import { generateAnchorId, generateChapterId, normalizeNCMQuery } from '../../src/utils/id_utils';

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
});
