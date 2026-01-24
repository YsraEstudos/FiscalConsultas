import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from '../../src/../src/App';
import * as api from '../../src/../src/services/api';

// Mock heavy UI components to keep the test focused and fast
vi.mock('../../src/components/ResultDisplay', () => ({ ResultDisplay: () => null }));
vi.mock('../../src/components/GlossaryModal', () => ({ GlossaryModal: () => null }));
vi.mock('../../src/components/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../src/components/TutorialModal', () => ({ TutorialModal: () => null }));
vi.mock('../../src/components/StatsModal', () => ({ StatsModal: () => null }));
vi.mock('../../src/components/LoginModal', () => ({ LoginModal: () => null }));
vi.mock('../../src/components/ComparatorModal', () => ({ ComparatorModal: () => null }));
vi.mock('../../src/components/AIChat', () => ({ AIChat: () => null }));
vi.mock('../../src/components/CrossNavContextMenu', () => ({ CrossNavContextMenu: () => null }));
vi.mock('../../src/components/TabsBar', () => ({
    TabsBar: ({ tabs, activeTabId }: { tabs: Array<{ id: string; document: string }>; activeTabId: string }) => (
        <div>
            {tabs.map(tab => (
                <div key={tab.id} data-document={tab.document} data-active={tab.id === activeTabId}>
                    {tab.document}
                </div>
            ))}
        </div>
    )
}));

// Mock dependencies
vi.mock('../../src/services/api', () => ({
    searchNCM: vi.fn(),
    searchTip: vi.fn(),
    getGlossaryTerm: vi.fn()
}));

// Mock Settings Context
const mockSettings = {
    settings: { theme: 'light' },
    updateSettings: vi.fn(),
    highlightEnabled: true
};
vi.mock('../../src/context/SettingsContext', () => ({
    useSettings: () => mockSettings,
    SettingsProvider: ({ children }) => <div>{children}</div>
}));

// Mock Auth Context
const mockAuth = {
    isAdmin: false,
    logout: vi.fn(),
    login: vi.fn()
};
vi.mock('../../src/context/AuthContext', () => ({
    useAuth: () => mockAuth,
    AuthProvider: ({ children }) => <div>{children}</div>
}));

// Mock History Hook
vi.mock('../../src/hooks/useHistory', () => ({
    useHistory: () => ({
        history: [],
        addToHistory: vi.fn(),
        removeFromHistory: vi.fn(),
        clearHistory: vi.fn()
    })
}));

describe('App Analysis - Context Switch', () => {
    it('Scenario 1: Clicking TIPI on an EMPTY tab should update the current tab (no new tab)', async () => {
        const { container } = render(<App />);

        // Initial State: 1 Tab (active)
        const tabs = container.querySelectorAll('[data-document]');
        expect(tabs.length).toBe(1);

        // Switch to TIPI
        const tipiBtn = screen.getByText('TIPI');
        fireEvent.click(tipiBtn);

        // Assert: Still 1 tab
        const updatedTabs = container.querySelectorAll('[data-document]');
        expect(updatedTabs.length).toBe(1);

        // Assert: Header subtitle switched to TIPI
        expect(screen.getByText('Tabela de Incidência do IPI')).toBeInTheDocument();
    });

    it('Scenario 2: Clicking TIPI on a POPULATED tab should open a NEW tab', async () => {
        // Mock successful search
        api.searchNCM.mockResolvedValue({
            type: 'text',
            results: [{ ncm: '8517', descricao: 'Telefones' }],
            markdown: '# 8517\nTelefones'
        });

        const { container } = render(<App />);

        // 1. Perform a search to populate existing tab
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: '8517' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        // Wait for search to complete (mocked)
        await waitFor(() => {
            expect(api.searchNCM).toHaveBeenCalled();
        });

        // Verify we still have 1 tab initially
        let tabs = container.querySelectorAll('[data-document]');
        expect(tabs.length).toBe(1);

        // 2. Click TIPI to switch context
        const tipiBtn = screen.getByText('TIPI');
        fireEvent.click(tipiBtn);

        // Assert: Now we should have 2 tabs!
        tabs = container.querySelectorAll('[data-document]');
        expect(tabs.length).toBe(2);

        // Assert: Header subtitle switched to TIPI
        expect(screen.getByText('Tabela de Incidência do IPI')).toBeInTheDocument();
    });
});
