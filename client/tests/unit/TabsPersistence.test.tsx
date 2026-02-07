import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from '../../src/App';
import { SettingsProvider } from '../../src/context/SettingsContext';

vi.mock('../../src/components/Layout', () => ({
    Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock('../../src/components/ModalManager', () => ({
    ModalManager: () => null
}));

vi.mock('../../src/components/ResultDisplay', () => ({
    ResultDisplay: () => <div data-testid="result-display" />
}));

vi.mock('../../src/components/ResultSkeleton', () => ({
    ResultSkeleton: () => <div data-testid="result-skeleton" />
}));

vi.mock('../../src/context/AuthContext', () => ({
    useAuth: () => ({ isAdmin: false, logout: vi.fn() })
}));

vi.mock('../../src/hooks/useHistory', () => ({
    useHistory: () => ({
        history: [],
        addToHistory: vi.fn(),
        removeFromHistory: vi.fn(),
        clearHistory: vi.fn()
    })
}));

vi.mock('../../src/hooks/useSearch', () => ({
    useSearch: () => ({ executeSearchForTab: vi.fn() })
}));

vi.mock('../../src/context/CrossChapterNoteContext', () => ({
    useCrossChapterNotes: () => ({
        fetchNotes: vi.fn(),
        getNote: vi.fn(),
        isLoading: vi.fn(() => false),
        cache: {}
    }),
    CrossChapterNoteProvider: ({ children }) => <div>{children}</div>
}));

describe('Tabs persistence in App', () => {
    it('keeps tab panes mounted when switching tabs', () => {
        const { container } = render(
            <SettingsProvider>
                <App />
            </SettingsProvider>
        );

        const newTabButton = container.querySelector('button[title="Nova aba"]') as HTMLButtonElement | null;
        expect(newTabButton).not.toBeNull();
        if (!newTabButton) return;

        fireEvent.click(newTabButton);

        const panesAfterCreate = container.querySelectorAll('[role="tabpanel"]');
        expect(panesAfterCreate.length).toBe(2);

        const tabButtons = container.querySelectorAll('[data-document]');
        expect(tabButtons.length).toBe(2);

        fireEvent.click(tabButtons[0]);

        const panesAfterSwitch = container.querySelectorAll('[role="tabpanel"]');
        expect(panesAfterSwitch.length).toBe(2);

        const activePanes = container.querySelectorAll('[role="tabpanel"]:not([hidden])');
        expect(activePanes.length).toBe(1);
    });
});
