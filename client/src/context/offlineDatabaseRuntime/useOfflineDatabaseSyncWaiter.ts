import { useCallback, useRef } from 'react';

import { OFFLINE_WAIT_TIMEOUT_MS } from '../offlineDatabaseSync';
import type { PendingOfflineDatabaseSyncWaiter } from '../offlineDatabase.types';

export interface OfflineDatabaseSyncWaiterApi {
    waitForOtherTabSync: () => Promise<void>;
    resolveSyncWaiter: () => void;
    rejectSyncWaiter: (message: string) => void;
}

export function useOfflineDatabaseSyncWaiter(): OfflineDatabaseSyncWaiterApi {
    const syncWaiterRef = useRef<PendingOfflineDatabaseSyncWaiter | null>(null);

    const resolveSyncWaiter = useCallback(() => {
        if (!syncWaiterRef.current) return;
        clearTimeout(syncWaiterRef.current.timeout);
        syncWaiterRef.current.resolve();
        syncWaiterRef.current = null;
    }, []);

    const rejectSyncWaiter = useCallback((message: string) => {
        if (!syncWaiterRef.current) return;
        clearTimeout(syncWaiterRef.current.timeout);
        syncWaiterRef.current.reject(new Error(message));
        syncWaiterRef.current = null;
    }, []);

    const waitForOtherTabSync = useCallback(
        () =>
            new Promise<void>((resolve, reject) => {
                if (syncWaiterRef.current) {
                    reject(new Error('Another synchronization is already pending'));
                    return;
                }

                syncWaiterRef.current = {
                    resolve,
                    reject,
                    timeout: setTimeout(() => {
                        rejectSyncWaiter(
                            'Outra aba iniciou a instalação offline, mas não concluiu a sincronização a tempo.',
                        );
                    }, OFFLINE_WAIT_TIMEOUT_MS),
                };
            }),
        [rejectSyncWaiter],
    );

    return {
        waitForOtherTabSync,
        resolveSyncWaiter,
        rejectSyncWaiter,
    };
}
