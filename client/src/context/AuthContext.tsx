/**
 * AuthContext - Integração com Clerk para Multi-Tenant B2B
 * 
 * Este contexto conecta o frontend ao sistema de autenticação Clerk,
 * expondo informações do usuário e organização atual.
 */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useUser, useAuth as useClerkAuth, useClerk, useOrganization } from '@clerk/react';
import {
    getAuthSession,
    registerClerkTokenGetter,
    unregisterClerkTokenGetter,
} from '../services/api';
import { hasPrivilegedRole } from '../utils/authz';

interface AuthContextType {
    // User Info
    isSignedIn: boolean;
    isLoading: boolean;
    userId: string | null;
    userName: string | null;
    userEmail: string | null;
    userImageUrl: string | null;

    // Organization (Tenant) Info
    orgId: string | null;
    orgName: string | null;
    orgSlug: string | null;

    // Token for API calls
    getToken: () => Promise<string | null>;
    canUseAiChat: boolean;
    canUseRestrictedUi: boolean;
    isAuthConfigured: boolean;
    authUnavailableReason: string | null;
    openLogin: () => void;

    // Legacy compatibility
    isAdmin: boolean;
    authToken: string | null;
    login: (token?: string | null) => void;  // Legacy: accepts token but Clerk handles auth
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

type CommonAuthState = {
    user: ReturnType<typeof useUser>['user'];
    isSignedIn: boolean;
    isLoading: boolean;
    getToken: ReturnType<typeof useClerkAuth>['getToken'];
    signOut: ReturnType<typeof useClerkAuth>['signOut'];
    openSignIn: ReturnType<typeof useClerk>['openSignIn'];
};

type OrganizationLike = {
    id?: string | null;
    name?: string | null;
    slug?: string | null;
} | null | undefined;

type MembershipLike = {
    role?: string | null;
} | null | undefined;

type AuthCapabilities = {
    canUseAiChat: boolean;
    canUseRestrictedUi: boolean;
};

const DEFAULT_AUTH_CAPABILITIES: AuthCapabilities = {
    canUseAiChat: false,
    canUseRestrictedUi: false,
};

function buildContextValue(
    baseState: CommonAuthState,
    organization: OrganizationLike,
    membership: MembershipLike,
    capabilities: AuthCapabilities,
    authUnavailableReason: string | null = null,
): AuthContextType {
    const { user, isSignedIn, isLoading, getToken, signOut, openSignIn } = baseState;

    return {
        isSignedIn,
        isLoading,
        userId: user?.id || null,
        userName: user?.fullName || user?.firstName || null,
        userEmail: user?.primaryEmailAddress?.emailAddress || null,
        userImageUrl: user?.imageUrl || null,
        orgId: organization?.id || null,
        orgName: organization?.name || null,
        orgSlug: organization?.slug || null,
        getToken: async () => {
            try {
                return await getToken();
            } catch (error) {
                console.error('[AuthContext] Failed to get token:', error);
                return null;
            }
        },
        canUseAiChat: capabilities.canUseAiChat,
        canUseRestrictedUi: capabilities.canUseRestrictedUi,
        isAuthConfigured: !authUnavailableReason,
        authUnavailableReason,
        openLogin: () => {
            if (!authUnavailableReason) {
                openSignIn();
            }
        },
        isAdmin: hasPrivilegedRole(membership?.role),
        authToken: null,
        login: (_token?: string | null) => {
            console.warn('[AuthContext] login() is deprecated. Use Clerk components.');
        },
        logout: () => {
            void signOut();
        }
    };
}

function SignedInAuthProvider({
    children,
    baseState,
    capabilities,
}: Readonly<{
    children: ReactNode;
    baseState: CommonAuthState;
    capabilities: AuthCapabilities;
}>) {
    const { organization, membership } = useOrganization();

    return (
        <AuthContext.Provider value={buildContextValue(baseState, organization, membership, capabilities)}>
            {children}
        </AuthContext.Provider>
    );
}

function createUnavailableContextValue(reason: string | null): AuthContextType {
    return {
        isSignedIn: false,
        isLoading: false,
        userId: null,
        userName: null,
        userEmail: null,
        userImageUrl: null,
        orgId: null,
        orgName: null,
        orgSlug: null,
        getToken: async () => null,
        canUseAiChat: false,
        canUseRestrictedUi: false,
        isAuthConfigured: false,
        authUnavailableReason: reason,
        openLogin: () => { },
        isAdmin: false,
        authToken: null,
        login: () => {
            console.warn('[AuthContext] login() unavailable while auth fallback mode is active.');
        },
        logout: () => { },
    };
}

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
    const { user, isSignedIn, isLoaded: userLoaded } = useUser();
    const { getToken, signOut, isLoaded: authLoaded } = useClerkAuth();
    const { openSignIn } = useClerk();
    const isLoading = !userLoaded || !authLoaded;
    const baseState: CommonAuthState = {
        user,
        isSignedIn: !!isSignedIn,
        isLoading,
        getToken,
        signOut,
        openSignIn,
    };
    const [capabilities, setCapabilities] = useState<AuthCapabilities>(DEFAULT_AUTH_CAPABILITIES);

    // Registra o getToken no módulo API para que o interceptor possa usá-lo
    useEffect(() => {
        registerClerkTokenGetter(getToken);
        return () => {
            unregisterClerkTokenGetter();
        };
    }, [getToken]);

    useEffect(() => {
        if (isLoading || !isSignedIn) {
            setCapabilities(DEFAULT_AUTH_CAPABILITIES);
            return undefined;
        }

        let cancelled = false;

        void getAuthSession()
            .then((session) => {
                if (cancelled) return;
                setCapabilities({
                    canUseAiChat: !!session.can_use_ai_chat,
                    canUseRestrictedUi: !!session.can_use_restricted_ui,
                });
            })
            .catch((error) => {
                if (cancelled) return;
                console.warn('[AuthContext] Failed to load auth session:', error);
                setCapabilities(DEFAULT_AUTH_CAPABILITIES);
            });

        return () => {
            cancelled = true;
        };
    }, [isLoading, isSignedIn, user?.id]);

    if (isSignedIn) {
        return (
            <SignedInAuthProvider baseState={baseState} capabilities={capabilities}>
                {children}
            </SignedInAuthProvider>
        );
    }

    return (
        <AuthContext.Provider value={buildContextValue(baseState, null, null, capabilities)}>
            {children}
        </AuthContext.Provider>
    );
}

export function AnonymousAuthProvider({
    children,
    reason = null,
}: Readonly<{
    children: ReactNode;
    reason?: string | null;
}>) {
    return (
        <AuthContext.Provider value={createUnavailableContextValue(reason)}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
