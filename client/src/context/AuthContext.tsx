import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AuthContextType {
    isAdmin: boolean;
    authToken: string | null;
    login: (token: string) => void;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [isAdmin, setIsAdmin] = useState<boolean>(false);
    const [authToken, setAuthToken] = useState<string | null>(null);

    // Check localStorage on mount
    useEffect(() => {
        const token = localStorage.getItem('auth_token');
        const adminStatus = localStorage.getItem('is_admin') === 'true';
        if (token && adminStatus) {
            setAuthToken(token);
            setIsAdmin(true);
        }
    }, []);

    const login = (token: string) => {
        setAuthToken(token);
        setIsAdmin(true);
        localStorage.setItem('auth_token', token);
        localStorage.setItem('is_admin', 'true');
    };

    const logout = () => {
        setAuthToken(null);
        setIsAdmin(false);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('is_admin');
    };

    return (
        <AuthContext.Provider value={{ isAdmin, login, logout, authToken }}>
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
