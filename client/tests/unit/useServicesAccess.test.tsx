import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useServicesAccess } from '../../src/hooks/useServicesAccess';
import type { SystemStatusResponse } from '../../src/types/api.types';

const refs = vi.hoisted(() => ({
  getSystemStatusMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../../src/services/api', () => ({
  getSystemStatus: refs.getSystemStatusMock,
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: refs.toastErrorMock,
  },
}));

type ServiceStatus = 'online' | 'error';

function makeSystemStatusResponse({
  status = 'online',
  nbs = 'online',
  nebs = 'online',
}: {
  status?: 'online' | 'error';
  nbs?: ServiceStatus;
  nebs?: ServiceStatus;
} = {}): SystemStatusResponse {
  return {
    status,
    database: { status: 'online' },
    tipi: { status: 'online' },
    nbs: { status: nbs },
    nebs: { status: nebs },
    catalogs: {
      nesh: { status: 'online' },
      tipi: { status: 'online' },
      nbs: { status: nbs },
      nebs: { status: nebs },
    },
  };
}

describe('useServicesAccess', () => {
  beforeEach(() => {
    refs.getSystemStatusMock.mockReset();
    refs.toastErrorMock.mockReset();
  });

  it('keeps services available when status is healthy for anonymous access', async () => {
    refs.getSystemStatusMock.mockResolvedValue(makeSystemStatusResponse());

    const { result } = renderHook(() => useServicesAccess());

    await waitFor(() => {
      expect(refs.getSystemStatusMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await expect(result.current.ensureServicesAccess()).resolves.toBe(true);
    });

    expect(refs.toastErrorMock).not.toHaveBeenCalled();
  });

  it('blocks access and exposes the offline reason when NBS/NEBS are offline', async () => {
    refs.getSystemStatusMock.mockResolvedValue(
      makeSystemStatusResponse({ status: 'error', nbs: 'error' }),
    );

    const { result } = renderHook(() => useServicesAccess());

    await waitFor(() => {
      expect(refs.getSystemStatusMock).toHaveBeenCalledTimes(1);
      expect(result.current.servicesUnavailableReason).toBe('Catálogo NBS indisponível no momento.');
    });

    await act(async () => {
      await expect(result.current.ensureServicesAccess()).resolves.toBe(false);
    });

    expect(refs.toastErrorMock).toHaveBeenCalledWith('Catálogo NBS indisponível no momento.');
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

  it('falls back to unknown instead of blocking on a stale offline snapshot', async () => {
    let currentTime = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => currentTime);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    refs.getSystemStatusMock.mockResolvedValue(
      makeSystemStatusResponse({ status: 'error', nbs: 'error' }),
    );

    try {
      const { result } = renderHook(() => useServicesAccess());

      await waitFor(() => {
        expect(result.current.servicesUnavailableReason).toBe('Catálogo NBS indisponível no momento.');
      });

      currentTime += 31_000;
      refs.getSystemStatusMock.mockRejectedValueOnce(new Error('status down'));

      await act(async () => {
        await expect(result.current.ensureServicesAccess()).resolves.toBe(true);
      });

      expect(refs.getSystemStatusMock).toHaveBeenCalledTimes(2);
      expect(refs.toastErrorMock).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(result.current.servicesAvailability).toBe('unknown');
        expect(result.current.servicesUnavailableReason).toBeNull();
      });
    } finally {
      warnSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it('falls back to unknown when a stale online snapshot cannot be refreshed', async () => {
    let currentTime = 2_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => currentTime);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    refs.getSystemStatusMock.mockResolvedValue(makeSystemStatusResponse());

    try {
      const { result } = renderHook(() => useServicesAccess());

      await waitFor(() => {
        expect(result.current.servicesAvailability).toBe('online');
      });

      currentTime += 31_000;
      refs.getSystemStatusMock.mockRejectedValueOnce(new Error('status down'));

      await act(async () => {
        await expect(result.current.ensureServicesAccess()).resolves.toBe(true);
      });

      expect(refs.getSystemStatusMock).toHaveBeenCalledTimes(2);
      await waitFor(() => {
        expect(result.current.servicesAvailability).toBe('unknown');
        expect(result.current.servicesUnavailableReason).toBeNull();
      });
      expect(refs.toastErrorMock).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it('fails fast for service searches when the offline snapshot is still fresh', async () => {
    refs.getSystemStatusMock.mockResolvedValue(
      makeSystemStatusResponse({ status: 'error', nbs: 'error', nebs: 'error' }),
    );

    const { result } = renderHook(() => useServicesAccess());

    await waitFor(() => {
      expect(result.current.servicesUnavailableReason).toBe('Catálogo NBS/NEBS indisponível no momento.');
    });

    refs.getSystemStatusMock.mockClear();

    await act(async () => {
      await expect(result.current.ensureServicesSearchAccess()).resolves.toBe(false);
    });

    expect(refs.getSystemStatusMock).not.toHaveBeenCalled();
    expect(refs.toastErrorMock).toHaveBeenCalledWith('Catálogo NBS/NEBS indisponível no momento.');
  });

  it('allows service search to proceed while status is still unknown', async () => {
    refs.getSystemStatusMock.mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useServicesAccess());

    await act(async () => {
      await expect(
        Promise.race([
          result.current.ensureServicesSearchAccess(),
          Promise.resolve<'pending'>('pending'),
        ]),
      ).resolves.toBe(true);
    });

    expect(refs.toastErrorMock).not.toHaveBeenCalled();
  });
});
