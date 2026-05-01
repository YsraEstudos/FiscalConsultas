import { expect, test, type Page } from '@playwright/test';

import {
  expectOfflineMetadataPersisted,
  expectOfflineReadyInSettings,
  installAuthSessionMock,
  installOfflineApiMock,
  installOfflineFromSettings,
  installOfflineWorkerMock,
  type OfflineApiCounters,
} from './helpers/offlineHarness';

const APP_SHELL_CACHE = 'app-shell-v3';
const RUNTIME_CACHE = 'runtime-assets-v3';

async function installOfflineSupportMock(page: Page) {
  await page.addInitScript(() => {
    function installSharedArrayBufferShim() {
      if (globalThis.SharedArrayBuffer === undefined) {
        Object.defineProperty(globalThis, 'SharedArrayBuffer', {
          configurable: true,
          value: class SharedArrayBufferShim {},
        });
      }
    }

    function defineOnObjectOrPrototype(target: object, key: string, value: unknown) {
      try {
        Object.defineProperty(target, key, {
          configurable: true,
          value,
        });
      } catch {
        const prototype = Object.getPrototypeOf(target);
        if (prototype) {
          Object.defineProperty(prototype, key, {
            configurable: true,
            value,
          });
        }
      }
    }

    function installCryptoSubtleShim() {
      const cryptoObject = globalThis.crypto as Crypto & { subtle?: unknown } | undefined;
      if (cryptoObject && cryptoObject.subtle === undefined) {
        defineOnObjectOrPrototype(cryptoObject, 'subtle', {});
      }
    }

    function installStorageDirectoryShim() {
      const navigatorWithStorage = navigator as Navigator & {
        storage?: { getDirectory?: unknown };
      };
      const storage = navigatorWithStorage.storage;
      if (!storage || typeof storage.getDirectory !== 'function') {
        const storageShim = {
          ...(storage && typeof storage === 'object' ? storage : {}),
          getDirectory: async () => ({}),
        };
        defineOnObjectOrPrototype(navigatorWithStorage, 'storage', storageShim);
      }
    }

    try {
      installSharedArrayBufferShim();
    } catch {
      // Some browsers expose this as a non-configurable global; ignore that.
    }

    try {
      installCryptoSubtleShim();
    } catch {
      // If crypto is read-only, the live spec will still surface the unsupported state.
    }

    try {
      installStorageDirectoryShim();
    } catch {
      // If storage is read-only, the live spec will still surface the unsupported state.
    }
  });
}

async function waitForOfflineShellCache(page: Page) {
  await page.waitForFunction(
    async ({ appShellCacheName, runtimeCacheName }) => {
      if (!navigator.serviceWorker?.controller) return false;
      if (!('caches' in globalThis)) return false;

      const [appShellCache, runtimeCache] = await Promise.all([
        caches.open(appShellCacheName),
        caches.open(runtimeCacheName),
      ]);
      const assetUrls = Array.from(
        document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
          'script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href]',
        ),
      ).map((element) => new URL(element.src || element.href, globalThis.location.href).toString());
      const urls = [
        globalThis.location.href,
        new URL('./', globalThis.location.href).toString(),
        new URL('./index.html', globalThis.location.href).toString(),
        ...assetUrls,
      ];

      for (const url of urls) {
        if ((await appShellCache.match(url)) || (await runtimeCache.match(url))) {
          continue;
        }
        return false;
      }

      return true;
    },
    {
      appShellCacheName: APP_SHELL_CACHE,
      runtimeCacheName: RUNTIME_CACHE,
    },
  );
}

function isOfflineNavigationError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('ERR_INTERNET_DISCONNECTED');
}

async function hasServiceWorkerSupport(page: Page): Promise<boolean> {
  return page.evaluate(() => globalThis.isSecureContext && 'serviceWorker' in navigator);
}

test.describe('live offline reopen with active service worker', () => {
  test('reopens fully offline with cached app shell and local DB ready state', async ({ page, context }) => {
    const counters: OfflineApiCounters = {
      version: 0,
      token: 0,
      download: 0,
    };

    await installOfflineSupportMock(page);
    await installOfflineWorkerMock(page);
    await installAuthSessionMock(page);
    await installOfflineApiMock(page, counters);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();
    const isSecureContext = await page.evaluate(() => globalThis.isSecureContext);
    test.skip(!isSecureContext, 'PLAYWRIGHT_LIVE_BASE_URL must resolve to a secure context such as localhost or HTTPS.');
    test.skip(!(await hasServiceWorkerSupport(page)), 'Current browser environment does not expose service workers for this origin.');
    await page.reload();
    await page.waitForFunction(() => window.crossOriginIsolated === true);
    const isSecureContextAfterReload = await page.evaluate(() => globalThis.isSecureContext);
    test.skip(!isSecureContextAfterReload, 'Current browser environment lost secure-context support after reload.');
    test.skip(!(await hasServiceWorkerSupport(page)), 'Current browser environment lost service worker support after reload.');

    await installOfflineFromSettings(page, 15_000);
    expect(counters.token).toBe(1);
    expect(counters.download).toBe(1);

    await page.keyboard.press('Escape');
    await expectOfflineMetadataPersisted(page);
    await waitForOfflineShellCache(page);

    await context.unroute('**/api/**');
    await context.unroute('**/api/auth/me*');
    await context.setOffline(true);
    try {
      await page.evaluate(() => {
        (globalThis as typeof globalThis & { __offlineReloadSentinel?: string }).__offlineReloadSentinel = 'before-reload';
      });

      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
      } catch (error) {
        if (!isOfflineNavigationError(error)) {
          throw error;
        }
      }

      await expect.poll(async () => {
        try {
          return await page.evaluate(
            () => (globalThis as typeof globalThis & { __offlineReloadSentinel?: string }).__offlineReloadSentinel ?? null,
          );
        } catch {
          return 'navigating';
        }
      }).toBe(null);

      await expect(page.getByRole('heading', { name: 'Busca NCM' })).toBeVisible();
      await expectOfflineMetadataPersisted(page);
      await expectOfflineReadyInSettings(page);
    } finally {
      await context.setOffline(false);
    }
  });
});
