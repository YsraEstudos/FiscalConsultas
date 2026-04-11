import { useEffect } from 'react';
import { ClerkProvider, SignIn, useAuth, useOrganization, useUser } from '@clerk/react';

import type { ClerkRuntimeSnapshot } from '../context/AuthContext';
import { clerkTheme } from '../config/clerkAppearance';
import { Modal } from '../components/Modal';

interface ClerkStateBridgeProps {
    onStateChange: (snapshot: ClerkRuntimeSnapshot) => void;
}

interface ClerkRuntimeHostProps {
    publishableKey: string;
    isLoginOpen: boolean;
    onCloseLogin: () => void;
    onStateChange: (snapshot: ClerkRuntimeSnapshot) => void;
}

function ClerkStateBridge({ onStateChange }: Readonly<ClerkStateBridgeProps>) {
    const { user, isSignedIn, isLoaded: userLoaded } = useUser();
    const { getToken, signOut, isLoaded: authLoaded } = useAuth();
    const { organization, membership } = useOrganization();

    useEffect(() => {
        onStateChange({
            user: user ?? null,
            isSignedIn: !!isSignedIn,
            isLoaded: userLoaded && authLoaded,
            getToken,
            signOut,
            organization: organization ?? null,
            membership: membership ?? null,
        });
    }, [
        authLoaded,
        getToken,
        isSignedIn,
        membership,
        onStateChange,
        organization,
        signOut,
        user,
        userLoaded,
    ]);

    return null;
}

export function ClerkRuntimeHost({
    publishableKey,
    isLoginOpen,
    onCloseLogin,
    onStateChange,
}: Readonly<ClerkRuntimeHostProps>) {
    return (
        <ClerkProvider publishableKey={publishableKey} appearance={clerkTheme}>
            <ClerkStateBridge onStateChange={onStateChange} />

            <Modal isOpen={isLoginOpen} onClose={onCloseLogin} title="Entrar">
                <SignIn />
            </Modal>
        </ClerkProvider>
    );
}
