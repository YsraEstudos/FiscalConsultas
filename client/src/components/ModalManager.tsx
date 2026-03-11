import React, { Suspense, lazy } from 'react';
import { useAuth } from '../context/AuthContext';
import { canAccessRestrictedUi } from '../utils/featureAccess';
import { useIsAdmin } from '../hooks/useIsAdmin';

// Lazy load modals
const SettingsModal = lazy(() => import('./SettingsModal').then(module => ({ default: module.SettingsModal })));
const TutorialModal = lazy(() => import('./TutorialModal').then(module => ({ default: module.TutorialModal })));
const StatsModal = lazy(() => import('./StatsModal').then(module => ({ default: module.StatsModal })));
const AIChat = lazy(() => import('./AIChat').then(module => ({ default: module.AIChat })));
const ComparatorModal = lazy(() => import('./ComparatorModal').then(module => ({ default: module.ComparatorModal })));
const ServicesModal = lazy(() => import('./ServicesModal').then(module => ({ default: module.ServicesModal })));
const CrossNavContextMenu = lazy(() => import('./CrossNavContextMenu').then(module => ({ default: module.CrossNavContextMenu })));
const AdminCommentModal = lazy(() => import('./AdminCommentModal').then(module => ({ default: module.AdminCommentModal })));

type DocType = 'nesh' | 'tipi';

interface ModalManagerProps {
    modals: {
        settings: boolean;
        tutorial: boolean;
        stats: boolean;
        comparator: boolean;
        services: boolean;
        moderate: boolean;
    };
    onClose: {
        settings: () => void;
        tutorial: () => void;
        stats: () => void;
        comparator: () => void;
        services: () => void;
        moderate: () => void;
    };
    currentDoc: DocType;
    onOpenInDoc: (doc: DocType, ncm: string) => void;
    onOpenInNewTab: (doc: DocType, ncm: string) => void;
}

export const ModalManager: React.FC<ModalManagerProps> = ({
    modals,
    onClose,
    currentDoc,
    onOpenInDoc,
    onOpenInNewTab
}) => {
    const { isSignedIn, userEmail } = useAuth();
    const isAdmin = useIsAdmin();
    const canUseRestrictedUi = canAccessRestrictedUi(userEmail);

    return (
        <Suspense fallback={null}>
            <SettingsModal isOpen={modals.settings} onClose={onClose.settings} />
            <TutorialModal isOpen={modals.tutorial} onClose={onClose.tutorial} />
            <StatsModal isOpen={modals.stats} onClose={onClose.stats} />

            {modals.comparator && (
                <ComparatorModal
                    isOpen
                    onClose={onClose.comparator}
                    defaultDoc={currentDoc}
                />
            )}

            {modals.services && (
                <ServicesModal
                    isOpen
                    onClose={onClose.services}
                />
            )}

            <CrossNavContextMenu
                currentDoc={currentDoc}
                onOpenInDoc={onOpenInDoc}
                onOpenInNewTab={onOpenInNewTab}
            />

            {isSignedIn && canUseRestrictedUi && <AIChat />}

            {isAdmin && modals.moderate && (
                <AdminCommentModal isOpen onClose={onClose.moderate} />
            )}
        </Suspense>
    );
};
