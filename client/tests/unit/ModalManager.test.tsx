import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModalManager } from '../../src/components/ModalManager';

const authState = {
    isSignedIn: true,
    userEmail: 'blocked@example.com',
    isAdmin: false,
};

const modalManagerProps = {
    modals: {
        settings: false,
        tutorial: false,
        stats: false,
        comparator: false,
        services: false,
        moderate: false,
    },
    onClose: {
        settings: vi.fn(),
        tutorial: vi.fn(),
        stats: vi.fn(),
        comparator: vi.fn(),
        services: vi.fn(),
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

vi.mock('../../src/utils/featureAccess', () => ({
    canAccessRestrictedUi: (email: string | null | undefined) => (email || '').toLowerCase() === 'allowed-test@example.com',
}));

vi.mock('../../src/components/AIChat', () => ({
    AIChat: () => <div data-testid="ai-chat-trigger" title="Abrir Chat IA">AI Chat</div>
}));

vi.mock('../../src/components/SettingsModal', () => ({
    SettingsModal: ({ isOpen }: { isOpen: boolean }) => <div data-testid="settings-modal" data-open={String(isOpen)} />
}));

vi.mock('../../src/components/TutorialModal', () => ({
    TutorialModal: ({ isOpen }: { isOpen: boolean }) => <div data-testid="tutorial-modal" data-open={String(isOpen)} />
}));

vi.mock('../../src/components/StatsModal', () => ({
    StatsModal: ({ isOpen }: { isOpen: boolean }) => <div data-testid="stats-modal" data-open={String(isOpen)} />
}));

vi.mock('../../src/components/ComparatorModal', () => ({
    ComparatorModal: ({ isOpen, defaultDoc }: { isOpen: boolean; defaultDoc: string }) => (
        <div data-testid="comparator-modal" data-open={String(isOpen)} data-doc={defaultDoc} />
    )
}));

vi.mock('../../src/components/ServicesModal', () => ({
    ServicesModal: ({ isOpen }: { isOpen: boolean }) => (
        <div data-testid="services-modal" data-open={String(isOpen)} />
    )
}));

vi.mock('../../src/components/CrossNavContextMenu', () => ({
    CrossNavContextMenu: ({ currentDoc }: { currentDoc: string }) => (
        <div data-testid="cross-nav-context" data-doc={currentDoc} />
    )
}));

vi.mock('../../src/components/AdminCommentModal', () => ({
    AdminCommentModal: () => <div data-testid="admin-comment-modal">Admin moderation</div>
}));

describe('ModalManager', () => {
    beforeEach(() => {
        authState.isSignedIn = true;
        authState.userEmail = 'blocked@example.com';
        authState.isAdmin = false;
        vi.clearAllMocks();
    });

    it('hides AI chat for signed-in users without the allowed email', () => {
        renderModalManager();

        expect(screen.queryByTestId('ai-chat-trigger')).not.toBeInTheDocument();
        expect(screen.queryByTitle('Abrir Chat IA')).not.toBeInTheDocument();
    });

    it('shows AI chat for the allowed email', async () => {
        authState.userEmail = 'allowed-test@example.com';

        renderModalManager();

        expect(await screen.findByTestId('ai-chat-trigger')).toBeInTheDocument();
        expect(await screen.findByTitle('Abrir Chat IA')).toBeInTheDocument();
    });

    it('keeps AI chat hidden when the user is signed out even with an allowed email', () => {
        authState.isSignedIn = false;
        authState.userEmail = 'allowed-test@example.com';

        renderModalManager();

        expect(screen.queryByTestId('ai-chat-trigger')).not.toBeInTheDocument();
    });

    it('keeps moderation modal hidden for non-admin users even when requested', () => {
        render(
            <ModalManager
                {...modalManagerProps}
                modals={{ ...modalManagerProps.modals, moderate: true }}
            />
        );

        expect(screen.queryByTestId('admin-comment-modal')).not.toBeInTheDocument();
    });

    it('renders moderation modal for admins when requested', async () => {
        authState.isAdmin = true;

        render(
            <ModalManager
                {...modalManagerProps}
                modals={{ ...modalManagerProps.modals, moderate: true }}
            />
        );

        expect(await screen.findByTestId('admin-comment-modal')).toBeInTheDocument();
    });

    it('passes modal open state and current document to the lazy modal children', async () => {
        render(
            <ModalManager
                {...modalManagerProps}
                modals={{
                    ...modalManagerProps.modals,
                    settings: true,
                    tutorial: true,
                    stats: true,
                    comparator: true,
                    services: true,
                }}
                currentDoc="tipi"
            />
        );

        expect(await screen.findByTestId('settings-modal')).toHaveAttribute('data-open', 'true');
        expect(await screen.findByTestId('tutorial-modal')).toHaveAttribute('data-open', 'true');
        expect(await screen.findByTestId('stats-modal')).toHaveAttribute('data-open', 'true');
        expect(await screen.findByTestId('comparator-modal')).toHaveAttribute('data-open', 'true');
        expect(await screen.findByTestId('comparator-modal')).toHaveAttribute('data-doc', 'tipi');
        expect(await screen.findByTestId('services-modal')).toHaveAttribute('data-open', 'true');
        expect(await screen.findByTestId('cross-nav-context')).toHaveAttribute('data-doc', 'tipi');
    });
});
