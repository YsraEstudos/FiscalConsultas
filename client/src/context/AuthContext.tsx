/**
 * AuthContext - Integração com Clerk para Multi-Tenant B2B
 * 
 * Este contexto conecta o frontend ao sistema de autenticação Clerk,
 * expondo informações do usuário e organização atual.
 */
import { createContext, useContext, useEffect, ReactNode } from 'react';
import { useUser, useAuth as useClerkAuth, useOrganization } from '@clerk/react';
import { registerClerkTokenGetter, unregisterClerkTokenGetter } from '../services/api';
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
};

type OrganizationLike = {
    id?: string | null;
    name?: string | null;
    slug?: string | null;
} | null | undefined;

type MembershipLike = {
    role?: string | null;
} | null | undefined;

function buildContextValue(
    baseState: CommonAuthState,
    organization: OrganizationLike,
    membership: MembershipLike,
): AuthContextType {
    const { user, isSignedIn, isLoading, getToken, signOut } = baseState;

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
}: {
    children: ReactNode;
    baseState: CommonAuthState;
}) {
    const { organization, membership } = useOrganization();

    return (
        <AuthContext.Provider value={buildContextValue(baseState, organization, membership)}>
            {children}
        </AuthContext.Provider>
    );
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const { user, isSignedIn, isLoaded: userLoaded } = useUser();
    const { getToken, signOut, isLoaded: authLoaded } = useClerkAuth();
    const isLoading = !userLoaded || !authLoaded;
    const baseState: CommonAuthState = {
        user,
        isSignedIn: !!isSignedIn,
        isLoading,
        getToken,
        signOut,
    };

    // Registra o getToken no módulo API para que o interceptor possa usá-lo
    useEffect(() => {
        registerClerkTokenGetter(getToken);
        return () => {
            unregisterClerkTokenGetter();
        };
    }, [getToken]);

    // Log auth state for debugging (dev only)
    useEffect(() => {
        if (import.meta.env.DEV && !isLoading) {
            console.log('[AuthContext] State:', {
                isSignedIn,
                userId: user?.id,
                hasOrganizationAccess: !!isSignedIn,
            });
        }
    }, [isLoading, isSignedIn, user?.id]);

    if (isSignedIn) {
        return <SignedInAuthProvider baseState={baseState}>{children}</SignedInAuthProvider>;
    }

    return (
        <AuthContext.Provider value={buildContextValue(baseState, null, null)}>
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
