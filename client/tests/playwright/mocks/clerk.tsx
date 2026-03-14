import React, { createElement, Fragment } from 'react';

const mockAuthState = {
  isSignedIn: true,
  getToken: async () => 'e2e-token',
  signOut: async () => undefined,
};

const mockUser = {
  id: 'user_e2e',
  fullName: 'E2E User',
  firstName: 'E2E',
  primaryEmailAddress: { emailAddress: 'e2e@example.com' },
  imageUrl: '',
};

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  return createElement(Fragment, null, children);
}

export function SignedIn({ children }: { children: React.ReactNode }) {
  return mockAuthState.isSignedIn ? createElement(Fragment, null, children) : null;
}

export function SignedOut({ children }: { children: React.ReactNode }) {
  return mockAuthState.isSignedIn ? null : createElement(Fragment, null, children);
}

export function SignInButton({ children }: { children: React.ReactNode }) {
  return createElement(Fragment, null, children);
}

export function SignUpButton({ children }: { children: React.ReactNode }) {
  return createElement(Fragment, null, children);
}

export function UserButton() {
  return createElement('div', { 'data-testid': 'clerk-user-button' });
}

export function OrganizationSwitcher() {
  return createElement('div', { 'data-testid': 'clerk-org-switcher' });
}

export function SignIn() {
  return null;
}

export function UserProfile() {
  return createElement('div', { 'data-testid': 'clerk-user-profile' });
}

export function OrganizationProfile() {
  return createElement('div', { 'data-testid': 'clerk-organization-profile' });
}

export function useClerk() {
  return {
    signOut: mockAuthState.signOut,
  };
}

export function useUser() {
  return {
    user: mockAuthState.isSignedIn ? mockUser : null,
    isSignedIn: mockAuthState.isSignedIn,
    isLoaded: true,
  };
}

export function useAuth() {
  return {
    getToken: mockAuthState.getToken,
    signOut: mockAuthState.signOut,
    isSignedIn: mockAuthState.isSignedIn,
    isLoaded: true,
  };
}

export function useOrganization() {
  return {
    organization: { id: 'org_e2e', name: 'E2E Org', slug: 'e2e-org' },
    membership: { role: 'org:admin' },
  };
}
