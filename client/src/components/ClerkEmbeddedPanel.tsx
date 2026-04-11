import { ClerkProvider, OrganizationProfile, UserProfile } from '@clerk/react';

import { clerkTheme } from '../config/clerkAppearance';

type ClerkEmbeddedPanelMode = 'user' | 'organization';

interface ClerkEmbeddedPanelProps {
    mode: ClerkEmbeddedPanelMode;
}

function getPublishableKey(): string {
    return (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '').trim();
}

const embeddedAppearance = {
    ...clerkTheme,
    elements: {
        ...clerkTheme.elements,
        rootBox: { width: '100%' },
        card: { backgroundColor: 'transparent', border: 'none', boxShadow: 'none' },
        navbar: { display: 'none' },
        pageScrollBox: { padding: 0 },
    },
};

export function ClerkEmbeddedPanel({ mode }: Readonly<ClerkEmbeddedPanelProps>) {
    const publishableKey = getPublishableKey();

    if (!publishableKey) {
        return <div>Configurações de conta indisponíveis no momento.</div>;
    }

    return (
        <ClerkProvider publishableKey={publishableKey} appearance={clerkTheme}>
            {mode === 'organization' ? (
                <OrganizationProfile appearance={embeddedAppearance} />
            ) : (
                <UserProfile appearance={embeddedAppearance} />
            )}
        </ClerkProvider>
    );
}
