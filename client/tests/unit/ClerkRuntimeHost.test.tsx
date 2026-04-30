import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClerkRuntimeHost } from '../../src/auth/ClerkRuntimeHost';

const refs = vi.hoisted(() => ({
  userState: {
    user: { id: 'user_123' },
    isSignedIn: true,
    isLoaded: true,
  },
  authState: {
    getToken: vi.fn(),
    signOut: vi.fn(),
    isLoaded: true,
  },
  organizationState: {
    organization: { id: 'org_123' },
    membership: { role: 'org:admin' },
  },
}));

vi.mock('../../src/config/clerkAppearance', () => ({
  clerkTheme: { variables: {} },
}));

vi.mock('../../src/components/Modal', () => ({
  Modal: ({
    isOpen,
    onClose,
    title,
    children,
  }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
  }) => (
    <div
      data-testid="login-modal"
      data-open={String(isOpen)}
      data-title={title}
      data-has-close={String(typeof onClose === 'function')}
    >
      {children}
    </div>
  ),
}));

vi.mock('@clerk/react', () => ({
  ClerkProvider: ({
    children,
    publishableKey,
  }: {
    children: React.ReactNode;
    publishableKey: string;
  }) => (
    <div data-testid="clerk-provider" data-publishable-key={publishableKey}>
      {children}
    </div>
  ),
  SignIn: () => <div data-testid="clerk-sign-in">Sign in</div>,
  useUser: () => refs.userState,
  useAuth: () => refs.authState,
  useOrganization: () => refs.organizationState,
}));

describe('ClerkRuntimeHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refs.userState.user = { id: 'user_123' };
    refs.userState.isSignedIn = true;
    refs.userState.isLoaded = true;
    refs.authState.isLoaded = true;
    refs.organizationState.organization = { id: 'org_123' };
    refs.organizationState.membership = { role: 'org:admin' };
  });

  it('bridges Clerk state into the host callback', async () => {
    const onStateChange = vi.fn();

    render(
      <ClerkRuntimeHost
        publishableKey="pk_test_123"
        isLoginOpen={false}
        onCloseLogin={vi.fn()}
        onStateChange={onStateChange}
      />,
    );

    await waitFor(() => {
      expect(onStateChange).toHaveBeenCalledWith({
        user: { id: 'user_123' },
        isSignedIn: true,
        isLoaded: true,
        getToken: refs.authState.getToken,
        signOut: refs.authState.signOut,
        organization: { id: 'org_123' },
        membership: { role: 'org:admin' },
      });
    });
  });

  it('renders the login modal and sign-in content', () => {
    render(
      <ClerkRuntimeHost
        publishableKey="pk_test_456"
        isLoginOpen={true}
        onCloseLogin={vi.fn()}
        onStateChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('clerk-provider')).toHaveAttribute('data-publishable-key', 'pk_test_456');
    expect(screen.getByTestId('login-modal')).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('login-modal')).toHaveAttribute('data-title', 'Entrar');
    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument();
  });

  it('reports unloaded state and null organization data when Clerk has not finished booting', async () => {
    refs.userState.user = null;
    refs.userState.isSignedIn = false;
    refs.userState.isLoaded = false;
    refs.authState.isLoaded = false;
    refs.organizationState.organization = null;
    refs.organizationState.membership = null;
    const onStateChange = vi.fn();

    render(
      <ClerkRuntimeHost
        publishableKey="pk_test_789"
        isLoginOpen={false}
        onCloseLogin={vi.fn()}
        onStateChange={onStateChange}
      />,
    );

    await waitFor(() => {
      expect(onStateChange).toHaveBeenCalledWith({
        user: null,
        isSignedIn: false,
        isLoaded: false,
        getToken: refs.authState.getToken,
        signOut: refs.authState.signOut,
        organization: null,
        membership: null,
      });
    });
  });
});
