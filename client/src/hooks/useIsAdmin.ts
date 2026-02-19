import { useAuth } from '../context/AuthContext';

/**
 * Retorna true se o usuário é admin na organização Clerk.
 * Delega ao AuthContext que verifica membership.role === 'org:admin'.
 */
export function useIsAdmin(): boolean {
    const { isAdmin } = useAuth();
    return isAdmin;
}
