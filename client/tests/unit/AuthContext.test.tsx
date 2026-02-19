import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type React from 'react';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';

const refs = vi.hoisted(() => ({
  registerGetterMock: vi.fn(),
  unregisterGetterMock: vi.fn(),
  getTokenMock: vi.fn(),
  signOutMock: vi.fn(),
  userStateRef: {
    value: {
      user: {
        id: 'user_1',
        fullName: 'User Teste',
        firstName: 'User',
        primaryEmailAddress: { emailAddress: 'user@demo.com' },
        imageUrl: 'https://demo/avatar.png',
      },
      isSignedIn: true,
      isLoaded: true,
    },
  },
  authStateRef: {
    value: {
      getToken: null as unknown as (() => Promise<string | null>),
      signOut: null as unknown as (() => Promise<void>),
      isLoaded: true,
    },
  },
  orgStateRef: {
    value: {
      organization: {
        id: 'org_1',
        name: 'Org Demo',
        slug: 'org-demo',
      },
    },
  },
}));

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => refs.userStateRef.value,
  useAuth: () => refs.authStateRef.value,
  useOrganization: () => refs.orgStateRef.value,
}));

vi.mock('../../src/services/api', () => ({
  registerClerkTokenGetter: refs.registerGetterMock,
  unregisterClerkTokenGetter: refs.unregisterGetterMock,
}));

const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refs.getTokenMock.mockResolvedValue('jwt-token');
    refs.signOutMock.mockResolvedValue(undefined);
    refs.authStateRef.value = {
      getToken: refs.getTokenMock,
      signOut: refs.signOutMock,
      isLoaded: true,
    };
    refs.userStateRef.value = {
      user: {
        id: 'user_1',
        fullName: 'User Teste',
        firstName: 'User',
        primaryEmailAddress: { emailAddress: 'user@demo.com' },
        imageUrl: 'https://demo/avatar.png',
      },
      isSignedIn: true,
      isLoaded: true,
    };
    refs.orgStateRef.value = {
      organization: {
        id: 'org_1',
        name: 'Org Demo',
        slug: 'org-demo',
      },
    };
  });

  it('throws when useAuth is called outside provider', () => {
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within an AuthProvider');
  });

  it('exposes mapped user/org fields and registers API token getter', () => {
    const { result, unmount } = renderHook(() => useAuth(), { wrapper });

    expect(refs.registerGetterMock).toHaveBeenCalledWith(refs.getTokenMock);
    expect(result.current.isSignedIn).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.userId).toBe('user_1');
    expect(result.current.userName).toBe('User Teste');
    expect(result.current.userEmail).toBe('user@demo.com');
    expect(result.current.userImageUrl).toBe('https://demo/avatar.png');
    expect(result.current.orgId).toBe('org_1');
    expect(result.current.orgName).toBe('Org Demo');
    expect(result.current.orgSlug).toBe('org-demo');

    unmount();
    expect(refs.unregisterGetterMock).toHaveBeenCalledTimes(1);
  });

  it('handles missing user/org data and loading flags', () => {
    refs.userStateRef.value = {
      user: null,
      isSignedIn: false,
      isLoaded: false,
    } as any;
    refs.authStateRef.value = {
      getToken: refs.getTokenMock,
      signOut: refs.signOutMock,
      isLoaded: false,
    };
    refs.orgStateRef.value = { organization: null } as any;

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.isSignedIn).toBe(false);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.userId).toBeNull();
    expect(result.current.userName).toBeNull();
    expect(result.current.userEmail).toBeNull();
    expect(result.current.userImageUrl).toBeNull();
    expect(result.current.orgId).toBeNull();
    expect(result.current.orgName).toBeNull();
    expect(result.current.orgSlug).toBeNull();
  });

  it('returns token on success and null when getToken throws', async () => {
    const { result, rerender } = renderHook(() => useAuth(), { wrapper });

    await expect(result.current.getToken()).resolves.toBe('jwt-token');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    refs.getTokenMock.mockRejectedValueOnce(new Error('failed'));
    rerender();

    let token: string | null = 'placeholder';
    await act(async () => {
      token = await result.current.getToken();
    });

    expect(token).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith('[AuthContext] Failed to get token:', expect.any(Error));
    errorSpy.mockRestore();
  });

  it('keeps legacy compatibility behaviors for login/logout fields', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.authToken).toBeNull();

    act(() => {
      result.current.login('legacy-token');
      result.current.logout();
    });

    expect(warnSpy).toHaveBeenCalledWith('[AuthContext] login() is deprecated. Use Clerk components.');
    expect(refs.signOutMock).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
