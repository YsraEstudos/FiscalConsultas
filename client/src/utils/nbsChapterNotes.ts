import chapterNotesCatalog from '../data/nbsChapterNotes.json';
import {
    buildNbsChapterNotesDocumentHtml,
    escapeNbsChapterNotesHtml,
    resolveNbsChapterNotesPreviewTheme,
} from './nbsChapterNotesDocument';
import { injectServiceLinks } from './serviceCodes';

export type { NbsChapterNotesPreviewTheme } from './nbsChapterNotesDocument';
export {
    buildNbsChapterNotesDocumentHtml,
    resolveNbsChapterNotesPreviewTheme,
} from './nbsChapterNotesDocument';

export interface NbsChapterNoteSubitem {
    label: string;
    text: string;
}

export interface NbsChapterNoteItem {
    label: string;
    text: string;
    subitems: NbsChapterNoteSubitem[];
}

export interface NbsChapterNotesEntry {
    chapter: string;
    title: string;
    hasOfficialNotes: boolean;
    notes: NbsChapterNoteItem[];
}

export type OpenWindowCallback = (
    url?: string | URL,
    target?: string,
    features?: string,
) => Window | null;

const NBS_CHAPTER_NOTES = chapterNotesCatalog as Record<string, NbsChapterNotesEntry>;

const defaultOpenNbsChapterNotesWindow: OpenWindowCallback = (...args) =>
    globalThis.open?.(...args) ?? null;

/**
 * Build the inline HTML fragment used to render the official chapter notes body.
 *
 * Example:
 * `const markup = buildNbsChapterNotesMarkup(entry)`
 */
export function buildNbsChapterNotesMarkup(entry: NbsChapterNotesEntry): string {
    if (!entry.hasOfficialNotes || entry.notes.length === 0) {
        return '<p>Este capítulo não traz notas explicativas oficiais publicadas no PDF base da NBS.</p>';
    }

    const itemsHtml = entry.notes.map((item) => {
        const mainText = injectServiceLinks(escapeNbsChapterNotesHtml(item.text));
        const subitemsHtml = item.subitems.length > 0
            ? `
                <ol class="chapter-note-sublist" type="a">
                    ${item.subitems.map((subitem) => `
                        <li>
                            <p>${injectServiceLinks(escapeNbsChapterNotesHtml(subitem.text))}</p>
                        </li>
                    `).join('')}
                </ol>
            `
            : '';

        return `
            <li>
                <p>${mainText}</p>
                ${subitemsHtml}
            </li>
        `;
    }).join('');

    return `<ol class="chapter-note-list">${itemsHtml}</ol>`;
}

/**
 * Resolve the two-digit NBS chapter number from an NBS code.
 *
 * Example:
 * `const chapter = resolveNbsChapterNumberFromCode('1.0602.22.00')`
 */
export function resolveNbsChapterNumberFromCode(code: string | null | undefined): string | null {
    if (!code) return null;

    const digits = code.replace(/\D/g, '');
    if (digits.length < 3) return null;

    return digits.slice(1, 3);
}

export const getNbsChapterNumber = resolveNbsChapterNumberFromCode;

/**
 * Look up the official chapter-notes entry that matches the provided NBS code.
 *
 * Example:
 * `const entry = lookupNbsChapterNotesEntry('1.0601')`
 */
export function lookupNbsChapterNotesEntry(code: string | null | undefined): NbsChapterNotesEntry | null {
    const chapter = resolveNbsChapterNumberFromCode(code);
    if (!chapter) return null;

    return NBS_CHAPTER_NOTES[chapter] ?? null;
}

export const getNbsChapterNotesEntry = lookupNbsChapterNotesEntry;
export const renderNbsChapterNotesHtml = buildNbsChapterNotesMarkup;
export const openNbsChapterNotesTab = openNbsChapterNotesPreviewWindow;

/**
 * Return a frozen snapshot of the bundled chapter-notes catalog.
 *
 * Example:
 * `const catalog = getNbsChapterNotesCatalogSnapshot()`
 */
export function getNbsChapterNotesCatalogSnapshot(): Readonly<Record<string, NbsChapterNotesEntry>> {
    return Object.freeze(structuredClone(NBS_CHAPTER_NOTES));
}

/**
 * Open the chapter-notes preview in a dedicated popup window.
 *
 * Example:
 * `openNbsChapterNotesPreviewWindow(entry)`
 */
export function openNbsChapterNotesPreviewWindow(
    entry: NbsChapterNotesEntry,
    openWindow: OpenWindowCallback = defaultOpenNbsChapterNotesWindow,
): void {
    const chapterWindow = openWindow('', '_blank');
    if (!chapterWindow) return;

    const notesHtml = buildNbsChapterNotesMarkup(entry);
    const theme = resolveNbsChapterNotesPreviewTheme();

    chapterWindow.document.open();
    chapterWindow.document.write(
        buildNbsChapterNotesDocumentHtml(entry, notesHtml, theme),
    );
    chapterWindow.document.close();
}
