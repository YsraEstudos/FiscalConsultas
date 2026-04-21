import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildNbsChapterNotesDocumentHtml,
    buildNbsChapterNotesMarkup,
    getNbsChapterNotesCatalogSnapshot,
    lookupNbsChapterNotesEntry,
    openNbsChapterNotesPreviewWindow,
    resolveNbsChapterNotesPreviewTheme,
    resolveNbsChapterNumberFromCode,
} from './nbsChapterNotes';

describe('nbsChapterNotes', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('extracts the chapter number from NBS codes', () => {
        expect(resolveNbsChapterNumberFromCode('1.0602.22.00')).toBe('06');
        expect(resolveNbsChapterNumberFromCode('1.1703')).toBe('17');
        expect(resolveNbsChapterNumberFromCode('101022290')).toBe('01');
        expect(resolveNbsChapterNumberFromCode('texto livre')).toBeNull();
    });

    it('loads the official notes catalog for all chapters', () => {
        const catalog = getNbsChapterNotesCatalogSnapshot();

        expect(Object.keys(catalog)).toHaveLength(26);
        expect(catalog['06']?.title).toContain('apoio aos transportes');
        expect(catalog['16']?.hasOfficialNotes).toBe(false);
    });

    it('returns chapter notes using the active NBS code', () => {
        const chapter = lookupNbsChapterNotesEntry('1.0601');

        expect(chapter?.chapter).toBe('06');
        expect(chapter?.notes[0]?.text).toContain('armazenagem em depósitos');
    });

    it('renders a fallback paragraph when the chapter has no official notes', () => {
        const chapterWithoutNotes = lookupNbsChapterNotesEntry('1.1601');
        if (!chapterWithoutNotes) {
            throw new Error('Expected chapter 16 notes entry to exist');
        }

        expect(buildNbsChapterNotesMarkup(chapterWithoutNotes)).toContain(
            'não traz notas explicativas oficiais',
        );
    });

    it('escapes note content and injects service smart links into the notes markup', () => {
        const html = buildNbsChapterNotesMarkup({
            chapter: '06',
            title: 'Teste',
            hasOfficialNotes: true,
            notes: [{
                label: '1',
                text: 'Inclui o código <1.0601> e também 1.0602.22.00.',
                subitems: [{
                    label: 'a',
                    text: 'Subitem com 1.0603.11.00 e <script>alert(1)</script>.',
                }],
            }],
        });

        expect(html).toContain('&lt;');
        expect(html).not.toContain('<script>');
        expect(html).toContain('data-service-code="1.0601"');
        expect(html).toContain('data-service-code="1.0602.22.00"');
        expect(html).toContain('data-service-code="1.0603.11.00"');
    });

    it('builds the full preview document html with escaped chapter metadata and explicit theme', () => {
        const html = buildNbsChapterNotesDocumentHtml(
            {
                chapter: '06',
                title: 'Capítulo <Seguro>',
            },
            '<p>Notas renderizadas</p>',
            {
                accentPrimary: '#111111',
                accentSecondary: '#222222',
                backgroundPrimary: '#333333',
                cardBackground: '#444444',
                textPrimary: '#555555',
                textSecondary: '#666666',
                borderColor: '#777777',
            },
        );

        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('Capítulo 06 - Capítulo &lt;Seguro&gt;');
        expect(html).toContain('NBS • Explicações do capítulo');
        expect(html).toContain('<p>Notas renderizadas</p>');
        expect(html).toContain('#333333');
        expect(html).toContain('window.opener.nesh.smartLinkSearch');
    });

    it('falls back to default theme values when CSS variables are missing', () => {
        const getComputedStyleSpy = vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({
            getPropertyValue: () => '   ',
        } as CSSStyleDeclaration);

        const theme = resolveNbsChapterNotesPreviewTheme(document);

        expect(theme.backgroundPrimary).toBe('#0b1020');
        expect(theme.cardBackground).toBe('#14141e');
        expect(theme.textPrimary).toBe('#f8fafc');
        expect(getComputedStyleSpy).toHaveBeenCalled();
    });

    it('reads theme values from CSS variables when available', () => {
        vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({
            getPropertyValue: (propertyName: string) => ({
                '--accent-primary': '#101010',
                '--accent-secondary': '#202020',
                '--bg-primary': '#303030',
                '--dark-card-bg': '#404040',
                '--text-primary': '#505050',
                '--text-secondary': '#606060',
                '--border-color': '#707070',
            })[propertyName] ?? '',
        } as CSSStyleDeclaration);

        const theme = resolveNbsChapterNotesPreviewTheme(document);

        expect(theme.accentPrimary).toBe('#101010');
        expect(theme.borderColor).toBe('#707070');
    });

    it('writes the preview html into a popup window when available', () => {
        const chapter = lookupNbsChapterNotesEntry('1.0601');
        if (!chapter) {
            throw new Error('Expected chapter 06 notes entry to exist');
        }

        vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({
            getPropertyValue: () => '',
        } as CSSStyleDeclaration);

        const write = vi.fn();
        const open = vi.fn();
        const close = vi.fn();
        const openWindow = vi.fn(() => ({
            document: { open, write, close },
        })) as any;

        openNbsChapterNotesPreviewWindow(chapter, openWindow);

        expect(openWindow).toHaveBeenCalledWith('', '_blank');
        expect(open).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledWith(expect.stringContaining('Capítulo 06'));
        expect(write).toHaveBeenCalledWith(expect.stringContaining('#0b1020'));
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('returns early when the preview popup is blocked', () => {
        const chapter = lookupNbsChapterNotesEntry('1.0601');
        if (!chapter) {
            throw new Error('Expected chapter 06 notes entry to exist');
        }

        const openWindow = vi.fn(() => null);

        expect(() => {
            openNbsChapterNotesPreviewWindow(chapter, openWindow);
        }).not.toThrow();
        expect(openWindow).toHaveBeenCalledWith('', '_blank');
    });
});
