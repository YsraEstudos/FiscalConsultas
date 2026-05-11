import { useState, useEffect, useCallback, useRef } from 'react';

const POLLING_INTERVAL_MS = 5 * 60 * 1000;
const MIN_TIME_BETWEEN_CHECKS_MS = 60 * 1000;

interface AppUpdateResult {
  hasUpdateAvailable: boolean;
  applyUpdate: () => void;
}

interface VersionResponse {
  version?: string;
}

export function useAppUpdate(): AppUpdateResult {
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState<boolean>(false);
  const lastCheckRef = useRef<number>(0);

  const checkForUpdate = useCallback(async (): Promise<void> => {
    if (hasUpdateAvailable) return;

    const now = Date.now();
    if (now - lastCheckRef.current < MIN_TIME_BETWEEN_CHECKS_MS) {
      return; // Evita spam de rede caso o usuário mude de abas freneticamente
    }
    lastCheckRef.current = now;

    try {
      const baseUrl = import.meta.env.BASE_URL || '/';
      const versionUrl = `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/version.json?t=${Date.now()}`;
      
      const res = await fetch(versionUrl, {
        cache: 'no-store',
      });

      if (!res.ok) return;

      const data = (await res.json()) as VersionResponse;

      if (data?.version && data.version !== __APP_VERSION__) {
        console.log(`[AppUpdate] Nova versão detectada: ${data.version} (atual: ${__APP_VERSION__})`);
        setHasUpdateAvailable(true);
      }
    } catch (err) {
      console.warn('[AppUpdate] Falha ao verificar atualizações', err);
    }
  }, [hasUpdateAvailable]);

  useEffect(() => {
    const intervalId = window.setInterval(checkForUpdate, POLLING_INTERVAL_MS);

    let timeoutId: number | undefined;
    if (navigator.onLine) {
      timeoutId = window.setTimeout(checkForUpdate, 10000);
    }

    return () => {
      window.clearInterval(intervalId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [checkForUpdate]);

  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        void checkForUpdate();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [checkForUpdate]);

  const applyUpdate = (): void => {
    window.location.reload();
  };

  return { hasUpdateAvailable, applyUpdate };
}
