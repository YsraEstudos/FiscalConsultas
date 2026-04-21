export type SearchNavigationKey = 'ncm' | 'serviceCode';

export type OpenInNewTabHandler = (
    query: string,
    textQuery?: string,
    activate?: boolean,
) => Promise<void> | void;

export type OpenNoteHandler = (
    note: string,
    chapter?: string,
) => Promise<void> | void;

export interface NeshBridge {
    smartLinkSearch: (ncm: string) => void;
    openNote: (note: string, chapter?: string) => void;
    openSettings: () => void;
    openTextResultInNewTab: (
        ncm: string,
        textQuery?: string,
        activate?: boolean,
    ) => void;
}

export function splitSearchTerms(raw: string): string[] {
    return raw
        .split(/,/)
        .map((term) => term.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
}

function escapeCssIdentifier(value: string): string {
    if (
        typeof globalThis.CSS !== 'undefined'
        && typeof globalThis.CSS.escape === 'function'
    ) {
        return globalThis.CSS.escape(value);
    }

    return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

export function handleDelegatedSearchNavigation(
    target: Element,
    selector: string,
    dataKey: SearchNavigationKey,
    isBackgroundNavigation: boolean,
    event: MouseEvent,
    onSearch: (query: string) => void,
    onOpenInNewTab: OpenInNewTabHandler,
): boolean {
    const link = target.closest(selector);
    if (!(link instanceof HTMLElement)) {
        return false;
    }

    const value = link.dataset[dataKey];
    if (!value) {
        return false;
    }

    event.preventDefault();
    if (isBackgroundNavigation) {
        onOpenInNewTab(value, undefined, false);
        return true;
    }

    onSearch(value);
    return true;
}

export function handleDelegatedNoteNavigation(
    target: Element,
    event: MouseEvent,
    onOpenNote: OpenNoteHandler,
): boolean {
    const noteRef = target.closest('.note-ref');
    if (!(noteRef instanceof HTMLElement)) {
        return false;
    }

    const note = noteRef.dataset.note;
    if (!note) {
        return false;
    }

    event.preventDefault();
    onOpenNote(note, noteRef.dataset.chapter || undefined);
    return true;
}

export function scrollToNotesSection(
    activeTabId: string,
    chapter?: string,
): boolean {
    const container = document.getElementById(`results-content-${activeTabId}`);
    if (!container) {
        return false;
    }

    const escapedChapter = chapter ? escapeCssIdentifier(chapter) : '';
    const selectors = [
        ...(chapter ? [`#chapter-${escapedChapter}-notas`, `#chapter-${escapedChapter}`, `#cap-${escapedChapter}`] : []),
        '.section-notas',
        '.regras-gerais',
    ];

    let target: HTMLElement | null = null;
    for (const selector of selectors) {
        const element = container.querySelector<HTMLElement>(selector);
        if (element) {
            target = element;
            break;
        }
    }

    if (!target) {
        return false;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('flash-highlight');
    globalThis.setTimeout(() => target?.classList.remove('flash-highlight'), 2000);
    return true;
}
