import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClerkEmbeddedPanel } from '../../src/components/ClerkEmbeddedPanel';

vi.mock('../../src/config/clerkAppearance', () => ({
  clerkTheme: {
    elements: {
      rootBox: { width: 'auto' },
    },
  },
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
  UserProfile: ({ appearance }: { appearance: { elements: { rootBox: { width: string } } } }) => (
    <div data-testid="user-profile" data-root-width={appearance.elements.rootBox.width}>
      User profile
    </div>
  ),
  OrganizationProfile: ({ appearance }: { appearance: { elements: { rootBox: { width: string } } } }) => (
    <div data-testid="organization-profile" data-root-width={appearance.elements.rootBox.width}>
      Organization profile
    </div>
  ),
}));

describe('ClerkEmbeddedPanel', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders a fallback when the publishable key is missing', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');

    render(<ClerkEmbeddedPanel mode="user" />);

    expect(screen.getByText('Configurações de conta indisponíveis no momento.')).toBeInTheDocument();
    expect(screen.queryByTestId('clerk-provider')).not.toBeInTheDocument();
  });

  it('renders the user profile inside ClerkProvider when configured', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_123');

    render(<ClerkEmbeddedPanel mode="user" />);

    expect(screen.getByTestId('clerk-provider')).toHaveAttribute('data-publishable-key', 'pk_test_123');
    expect(screen.getByTestId('user-profile')).toHaveAttribute('data-root-width', '100%');
    expect(screen.queryByTestId('organization-profile')).not.toBeInTheDocument();
  });

  it('renders the organization profile branch when requested', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_123');

    render(<ClerkEmbeddedPanel mode="organization" />);

    expect(screen.getByTestId('organization-profile')).toHaveAttribute('data-root-width', '100%');
    expect(screen.queryByTestId('user-profile')).not.toBeInTheDocument();
  });
});
