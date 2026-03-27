import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useServicesAccess } from '../../src/hooks/useServicesAccess';

const refs = vi.hoisted(() => ({
  authStateRef: {
    value: {
      isLoading: false,
      isSignedIn: true,
    },
  },
  getSystemStatusMock: vi.fn(),
  openSignInMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => refs.authStateRef.value,
}));

vi.mock('@clerk/react', () => ({
  useClerk: () => ({
    openSignIn: refs.openSignInMock,
  }),
}));

vi.mock('../../src/services/api', () => ({
  getSystemStatus: refs.getSystemStatusMock,
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: refs.toastErrorMock,
  },
}));

describe('useServicesAccess', () => {
  beforeEach(() => {
    refs.authStateRef.value = {
      isLoading: false,
      isSignedIn: true,
    };
    refs.getSystemStatusMock.mockReset();
    refs.openSignInMock.mockReset();
    refs.toastErrorMock.mockReset();
  });

  it('opens Clerk login and skips status requests when the user is signed out', async () => {
    refs.authStateRef.value = {
      isLoading: false,
      isSignedIn: false,
    };

    const { result } = renderHook(() => useServicesAccess());

    await act(async () => {
      await expect(result.current.ensureServicesAccess()).resolves.toBe(false);
    });

    expect(refs.toastErrorMock).toHaveBeenCalledWith('Faça login para acessar o catálogo de serviços.');
    expect(refs.openSignInMock).toHaveBeenCalledTimes(1);
    expect(refs.getSystemStatusMock).not.toHaveBeenCalled();
  });

  it('blocks access and exposes the offline reason when NBS/NEBS are offline', async () => {
    refs.getSystemStatusMock.mockResolvedValue({
      status: 'error',
      database: { status: 'online' },
      tipi: { status: 'online' },
      nbs: { status: 'error' },
      nebs: { status: 'online' },
      catalogs: {
        nesh: { status: 'online' },
        tipi: { status: 'online' },
        nbs: { status: 'error' },
        nebs: { status: 'online' },
      },
    });

    const { result } = renderHook(() => useServicesAccess());

    await waitFor(() => {
      expect(refs.getSystemStatusMock).toHaveBeenCalledTimes(1);
      expect(result.current.servicesUnavailableReason).toBe('Catálogo NBS indisponível no momento.');
    });

    await act(async () => {
      await expect(result.current.ensureServicesAccess()).resolves.toBe(false);
    });

    expect(refs.toastErrorMock).toHaveBeenCalledWith('Catálogo NBS indisponível no momento.');
    expect(refs.openSignInMock).not.toHaveBeenCalled();
  });

  it('keeps access available when /api/status cannot be loaded and no offline state is known yet', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    refs.getSystemStatusMock.mockRejectedValue(new Error('status down'));

    try {
      const { result } = renderHook(() => useServicesAccess());

      await waitFor(() => {
        expect(refs.getSystemStatusMock).toHaveBeenCalledTimes(1);
      });

      expect(result.current.servicesUnavailableReason).toBeNull();

      await act(async () => {
        await expect(result.current.ensureServicesAccess()).resolves.toBe(true);
      });

      expect(refs.toastErrorMock).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
