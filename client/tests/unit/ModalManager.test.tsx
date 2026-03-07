import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModalManager } from '../../src/components/ModalManager';

const authState = {
    isSignedIn: false,
    userEmail: 'blocked@example.com',
};

vi.mock('../../src/context/AuthContext', () => ({
    AuthProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    useAuth: () => authState,
}));

vi.mock('../../src/components/AIChat', () => ({
    AIChat: () => <div data-testid="ai-chat-trigger">AI Chat</div>
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
        authState.isSignedIn = false;
        authState.userEmail = 'blocked@example.com';
    });

    it('hides AI chat for unauthorized users', () => {
        render(
            <ModalManager
                modals={{
                    settings: false,
                    tutorial: false,
                    stats: false,
                    comparator: false,
                    moderate: false,
                }}
                onClose={{
                    settings: vi.fn(),
                    tutorial: vi.fn(),
                    stats: vi.fn(),
                    comparator: vi.fn(),
                    moderate: vi.fn(),
                }}
                currentDoc="nesh"
                onOpenInDoc={vi.fn()}
                onOpenInNewTab={vi.fn()}
            />
        );

        expect(screen.queryByTestId('ai-chat-trigger')).not.toBeInTheDocument();
        expect(screen.queryByTitle('Abrir Chat IA')).not.toBeInTheDocument();
    });
});
