import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModalManager } from '../../src/components/ModalManager';

const authState = {
    isSignedIn: true,
    userEmail: 'blocked@example.com',
};

const modalManagerProps = {
    modals: {
        settings: false,
        tutorial: false,
        stats: false,
        comparator: false,
        moderate: false,
    },
    onClose: {
        settings: vi.fn(),
        tutorial: vi.fn(),
        stats: vi.fn(),
        comparator: vi.fn(),
        moderate: vi.fn(),
    },
    currentDoc: 'nesh' as const,
    onOpenInDoc: vi.fn(),
    onOpenInNewTab: vi.fn(),
};

function renderModalManager() {
    return render(<ModalManager {...modalManagerProps} />);
}

vi.mock('../../src/context/AuthContext', () => ({
    AuthProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    useAuth: () => authState,
}));

vi.mock('../../src/components/AIChat', () => ({
    AIChat: () => <div data-testid="ai-chat-trigger" title="Abrir Chat IA">AI Chat</div>
}));

vi.mock('../../src/components/SettingsModal', () => ({
    SettingsModal: () => null
}));

vi.mock('../../src/components/TutorialModal', () => ({
    TutorialModal: () => null
}));

vi.mock('../../src/components/StatsModal', () => ({
    StatsModal: () => null
}));

vi.mock('../../src/components/ComparatorModal', () => ({
    ComparatorModal: () => null
}));

vi.mock('../../src/components/CrossNavContextMenu', () => ({
    CrossNavContextMenu: () => null
}));

vi.mock('../../src/components/AdminCommentModal', () => ({
    AdminCommentModal: () => null
}));

describe('ModalManager', () => {
    beforeEach(() => {
        vi.stubEnv('VITE_RESTRICTED_UI_EMAILS', 'israelseja2@gmail.com');
        authState.isSignedIn = true;
        authState.userEmail = 'blocked@example.com';
        vi.clearAllMocks();
    });

    it('hides AI chat for signed-in users without the allowed email', () => {
        renderModalManager();

        expect(screen.queryByTestId('ai-chat-trigger')).not.toBeInTheDocument();
        expect(screen.queryByTitle('Abrir Chat IA')).not.toBeInTheDocument();
    });

    it('shows AI chat for the allowed email', async () => {
        authState.userEmail = 'israelseja2@gmail.com';

        renderModalManager();

        expect(await screen.findByTestId('ai-chat-trigger')).toBeInTheDocument();
        expect(await screen.findByTitle('Abrir Chat IA')).toBeInTheDocument();
    });
});
