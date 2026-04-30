import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { STORAGE_KEYS } from '../constants';
import { SettingsProvider, useSettings } from './SettingsContext';

function SettingsHarness() {
    const {
        nbsPrefixAutoExpand,
        toggleNbsPrefixAutoExpand,
        nbsChapterNotesNewTab,
        toggleNbsChapterNotesNewTab,
    } = useSettings();

    return (
        <div>
            <span data-testid="prefix-state">{nbsPrefixAutoExpand ? 'on' : 'off'}</span>
            <span data-testid="chapter-notes-tab-state">{nbsChapterNotesNewTab ? 'tab' : 'modal'}</span>
            <button type="button" onClick={toggleNbsPrefixAutoExpand}>toggle-prefix</button>
            <button type="button" onClick={toggleNbsChapterNotesNewTab}>toggle-chapter-notes</button>
        </div>
    );
}

describe('SettingsContext', () => {
    it('enables NBS prefix auto expand by default and persists toggles', async () => {
        localStorage.removeItem(STORAGE_KEYS.NBS_PREFIX_AUTO_EXPAND);

        render(
            <SettingsProvider>
                <SettingsHarness />
            </SettingsProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('prefix-state')).toHaveTextContent('on');
        });

        fireEvent.click(screen.getByRole('button', { name: 'toggle-prefix' }));

        await waitFor(() => {
            expect(screen.getByTestId('prefix-state')).toHaveTextContent('off');
        });

        expect(localStorage.getItem(STORAGE_KEYS.NBS_PREFIX_AUTO_EXPAND)).toBe('false');
    });

    it('opens chapter explanations in the current screen by default and persists toggles', async () => {
        localStorage.removeItem(STORAGE_KEYS.NBS_CHAPTER_NOTES_NEW_TAB);

        render(
            <SettingsProvider>
                <SettingsHarness />
            </SettingsProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('chapter-notes-tab-state')).toHaveTextContent('modal');
        });

        fireEvent.click(screen.getByRole('button', { name: 'toggle-chapter-notes' }));

        await waitFor(() => {
            expect(screen.getByTestId('chapter-notes-tab-state')).toHaveTextContent('tab');
        });

        expect(localStorage.getItem(STORAGE_KEYS.NBS_CHAPTER_NOTES_NEW_TAB)).toBe('true');
    });
});
