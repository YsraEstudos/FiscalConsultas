import { AppView } from './AppView';
import { useAppController } from './useAppController';
import { useAuth } from './context/AuthContext';
import { LoginGate } from './components/LoginGate';

/**
 * Rendered only when the user is authenticated.
 * Keeping useAppController in its own component ensures the hook is always
 * called unconditionally — satisfying React's rules of hooks (BUG-2 fix).
 */
function AuthenticatedApp() {
    const controller = useAppController();
    return <AppView controller={controller} />;
}

function App() {
    const { isSignedIn, isLoading, openLogin, isAuthConfigured } = useAuth();

    if (isLoading) {
        return null;
    }

    if (!isSignedIn) {
        return (
            <LoginGate
                onSignIn={openLogin}
                isAuthConfigured={isAuthConfigured}
            />
        );
    }

    return <AuthenticatedApp />;
}

export default App;
