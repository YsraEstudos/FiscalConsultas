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

    it('handles delegated smart link search navigation', () => {
        const link = document.createElement('a');
        link.className = 'smart-link';
        link.dataset.ncm = '8401';
        document.body.appendChild(link);

        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
        const onSearch = vi.fn();
        const onOpenInNewTab = vi.fn();

        const handled = handleDelegatedSearchNavigation(
            link,
            'a.smart-link',
            'ncm',
            false,
            event,
            onSearch,
            onOpenInNewTab,
        );

        expect(handled).toBe(true);
        expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
        expect(onSearch).toHaveBeenCalledWith('8401');
        expect(onOpenInNewTab).not.toHaveBeenCalled();
    });

    it('handles delegated smart link background navigation', () => {
        const link = document.createElement('a');
        link.className = 'smart-link';
        link.dataset.ncm = '8402';
        document.body.appendChild(link);

        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
        const onSearch = vi.fn();
        const onOpenInNewTab = vi.fn();

        const handled = handleDelegatedSearchNavigation(
            link,
            'a.smart-link',
            'ncm',
            true,
            event,
            onSearch,
            onOpenInNewTab,
        );

        expect(handled).toBe(true);
        expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
        expect(onSearch).not.toHaveBeenCalled();
        expect(onOpenInNewTab).toHaveBeenCalledWith('8402', undefined, false);
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

    it('handles delegated note navigation with a chapter', () => {
        const noteRef = document.createElement('button');
        noteRef.className = 'note-ref';
        noteRef.dataset.note = '1';
        noteRef.dataset.chapter = '84';
        document.body.appendChild(noteRef);

        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
        const onOpenNote = vi.fn();

        const handled = handleDelegatedNoteNavigation(noteRef, event, onOpenNote);

        expect(handled).toBe(true);
        expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
        expect(onOpenNote).toHaveBeenCalledWith('1', '84');
    });

    it('handles delegated note navigation without a chapter', () => {
        const noteRef = document.createElement('button');
        noteRef.className = 'note-ref';
        noteRef.dataset.note = '2';
        document.body.appendChild(noteRef);

        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
        const onOpenNote = vi.fn();

        const handled = handleDelegatedNoteNavigation(noteRef, event, onOpenNote);

        expect(handled).toBe(true);
        expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
        expect(onOpenNote).toHaveBeenCalledWith('2', undefined);
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

    it('keeps a full flash window when notes section scrolling repeats', () => {
        vi.useFakeTimers();

        const container = document.createElement('div');
        container.id = 'results-content-tab-1';
        const notesTarget = document.createElement('div');
        notesTarget.id = 'chapter-84-notas';
        container.appendChild(notesTarget);
        document.body.appendChild(container);
        vi.spyOn(notesTarget, 'scrollIntoView').mockImplementation(() => {});

        expect(scrollToNotesSection('tab-1', '84')).toBe(true);
        vi.advanceTimersByTime(1500);
        expect(scrollToNotesSection('tab-1', '84')).toBe(true);
        vi.advanceTimersByTime(1999);
        expect(notesTarget.classList.contains('flash-highlight')).toBe(true);
        vi.advanceTimersByTime(1);
        expect(notesTarget.classList.contains('flash-highlight')).toBe(false);
    });

    it('splits only on commas and preserves multi-word terms', () => {
        expect(splitSearchTerms('motor, bomba de agua')).toEqual(['motor', 'bomba de agua']);
    });

    it('trims and filters comma-separated search terms', () => {
        expect(splitSearchTerms('')).toEqual([]);
        expect(splitSearchTerms(',, , ')).toEqual([]);
        expect(splitSearchTerms(' motor ,  ')).toEqual(['motor']);
    });
});
