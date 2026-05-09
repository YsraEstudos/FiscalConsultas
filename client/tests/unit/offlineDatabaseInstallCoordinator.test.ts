import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  runCoordinatedOfflineDatabaseInstall,
} from '../../src/context/offlineDatabaseInstallCoordinator';
import {
  OFFLINE_LOCK_KEY,
} from '../../src/context/offlineDatabaseStorage';

type NavigatorWithLocks = Navigator & {
  locks?: {
    request: (
      name: string,
      optionsOrCallback:
        | { ifAvailable?: boolean; mode?: 'exclusive' | 'shared' }
        | ((lock: unknown) => Promise<void>),
      callback?: (lock: unknown) => Promise<void>,
    ) => Promise<void> | Promise<boolean>;
  };
};

function setNavigatorLocks(value: NavigatorWithLocks['locks']) {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value,
  });
}

function seedInstallLease(owner: string, expiresAt: number) {
  localStorage.setItem(
    OFFLINE_LOCK_KEY,
    JSON.stringify({
      owner,
      attempt: 1,
      startedAt: Date.now(),
      refreshedAt: Date.now(),
      expiresAt,
    }),
  );
}

describe('offlineDatabaseInstallCoordinator', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'locks');
  });

  it('uses Web Locks when available and runs the installer once', async () => {
    const request = vi.fn(
      async (
        _name: string,
        _options: { ifAvailable?: boolean },
        callback?: (lock: unknown) => Promise<void>,
      ) => {
        await callback({});
        return true;
      },
    );
    setNavigatorLocks({ request });
    const install = vi.fn().mockResolvedValue(undefined);

    await runCoordinatedOfflineDatabaseInstall({
      owner: 'tab-a',
      runInstall: install,
      waitForPeerInstall: vi.fn(),
      onWaitingForPeer: vi.fn(),
    });

    expect(request).toHaveBeenCalledWith(
      'offline-db-install',
      { ifAvailable: true, mode: 'exclusive' },
      expect.any(Function),
    );
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('does not queue duplicate installs behind an active Web Lock owner', async () => {
    let lockAvailable = false;
    const request = vi.fn(
      async (
        _name: string,
        _options: { ifAvailable?: boolean },
        callback?: (lock: unknown) => Promise<void>,
      ) => {
        if (!lockAvailable) {
          await callback(null);
          return false;
        }
        await callback({});
        return true;
      },
    );
    setNavigatorLocks({ request });
    seedInstallLease('tab-a', Date.now() + 180_000);

    const install = vi.fn().mockResolvedValue(undefined);
    const waitForPeerInstall = vi.fn(async () => {
      lockAvailable = true;
    });

    await runCoordinatedOfflineDatabaseInstall({
      owner: 'tab-b',
      runInstall: install,
      waitForPeerInstall,
      onWaitingForPeer: vi.fn(),
    });

    expect(waitForPeerInstall).toHaveBeenCalledTimes(1);
    expect(install).not.toHaveBeenCalled();
  });

  it('waits for a fresh fallback lease and takes over as soon as it expires', async () => {
    setNavigatorLocks(undefined);
    seedInstallLease('tab-a', Date.now() + 180_000);

    const install = vi.fn().mockResolvedValue(undefined);
    const waitForPeerInstall = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(new Error('peer timed out')), 240_000);
        }),
    );

    const promise = runCoordinatedOfflineDatabaseInstall({
      owner: 'tab-b',
      runInstall: install,
      waitForPeerInstall,
      onWaitingForPeer: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(181_000);
    await promise;

    expect(waitForPeerInstall).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('returns without installing when another tab finishes first', async () => {
    setNavigatorLocks(undefined);
    seedInstallLease('tab-a', Date.now() + 180_000);

    const install = vi.fn().mockResolvedValue(undefined);
    const waitForPeerInstall = vi.fn().mockResolvedValue(undefined);

    await runCoordinatedOfflineDatabaseInstall({
      owner: 'tab-b',
      runInstall: install,
      waitForPeerInstall,
      onWaitingForPeer: vi.fn(),
    });

    expect(waitForPeerInstall).toHaveBeenCalledTimes(1);
    expect(install).not.toHaveBeenCalled();
  });
});
