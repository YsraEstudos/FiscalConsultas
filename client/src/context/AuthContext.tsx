/**
 * AuthContext - Integração com Clerk para Multi-Tenant B2B
 * 
 * Este contexto conecta o frontend ao sistema de autenticação Clerk,
 * expondo informações do usuário e organização atual.
 */
import { createContext, useContext, useEffect, ReactNode } from 'react';
import { useUser, useAuth as useClerkAuth, useOrganization } from '@clerk/clerk-react';
import { registerClerkTokenGetter, unregisterClerkTokenGetter } from '../services/api';

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

export function AuthProvider({ children }: { children: ReactNode }) {
    const { user, isSignedIn, isLoaded: userLoaded } = useUser();
    const { getToken, signOut, isLoaded: authLoaded } = useClerkAuth();
    const { organization } = useOrganization();

    const isLoading = !userLoaded || !authLoaded;

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
                orgId: organization?.id,
                orgName: organization?.name
            });
        }
    }, [isLoading, isSignedIn, user?.id, organization?.id, organization?.name]);

    const contextValue: AuthContextType = {
        // User Info
        isSignedIn: !!isSignedIn,
        isLoading,
        userId: user?.id || null,
        userName: user?.fullName || user?.firstName || null,
        userEmail: user?.primaryEmailAddress?.emailAddress || null,
        userImageUrl: user?.imageUrl || null,

        // Organization (Tenant) Info
        orgId: organization?.id || null,
        orgName: organization?.name || null,
        orgSlug: organization?.slug || null,

        // Token for API calls - Clerk handles refresh automatically
        getToken: async () => {
            try {
                return await getToken();
            } catch (error) {
                console.error('[AuthContext] Failed to get token:', error);
                return null;
            }
        },

        // Legacy compatibility
        isAdmin: !!isSignedIn, // For now, all signed-in users are "admins"
        authToken: null, // Use getToken() instead
        login: (_token?: string | null) => {
            // No-op: Clerk's <SignIn /> component handles login UI
            console.warn('[AuthContext] login() is deprecated. Use Clerk components.');
        },
        logout: () => {
            void signOut();
        }
    };

    return (
        <AuthContext.Provider value={contextValue}>
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
