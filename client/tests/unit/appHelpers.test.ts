import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    handleDelegatedNoteNavigation,
    handleDelegatedSearchNavigation,
    scrollToNotesSection,
    splitSearchTerms,
} from '../../src/appHelpers';

describe('appHelpers', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('returns false when a delegated smart link is missing data', () => {
        const link = document.createElement('a');
        link.className = 'smart-link';
        document.body.appendChild(link);

        const child = document.createElement('span');
        link.appendChild(child);

        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const handled = handleDelegatedSearchNavigation(
            child,
            'a.smart-link',
            'ncm',
            false,
            event,
            vi.fn(),
            vi.fn(),
        );

        expect(handled).toBe(false);
        expect(event.defaultPrevented).toBe(false);
    });

    it('returns false when a delegated note ref is missing data', () => {
        const noteRef = document.createElement('button');
        noteRef.className = 'note-ref';
        document.body.appendChild(noteRef);

        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const handled = handleDelegatedNoteNavigation(
            noteRef,
            event,
            vi.fn(),
        );

        expect(handled).toBe(false);
        expect(event.defaultPrevented).toBe(false);
    });

    it('escapes chapter selectors when scrolling to notes section', () => {
        vi.useFakeTimers();

        const container = document.createElement('div');
        container.id = 'results-content-tab-1';
        const notesTarget = document.createElement('div');
        notesTarget.id = 'chapter-84.1-notas';
        container.appendChild(notesTarget);
        document.body.appendChild(container);

        const scrollSpy = vi.spyOn(notesTarget, 'scrollIntoView').mockImplementation(() => {});

        expect(scrollToNotesSection('tab-1', '84.1')).toBe(true);
        expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
        expect(notesTarget.classList.contains('flash-highlight')).toBe(true);

        vi.advanceTimersByTime(2000);
        expect(notesTarget.classList.contains('flash-highlight')).toBe(false);
    });

    it('splits only on commas and preserves multi-word terms', () => {
        expect(splitSearchTerms('motor, bomba de agua')).toEqual(['motor', 'bomba de agua']);
    });
});
