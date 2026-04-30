import { useCallback } from 'react';

import {
    compareOfflineVersions,
    formatOfflineDatabaseErrorMessage,
} from '../utils/offlineDatabase';

import {
    clearOfflineDatabaseInstallLock,
    getOfflineDatabaseInstallLock,
    persistStoredOfflineDatabaseMetadata,
    readStoredOfflineDatabaseMetadata,
    runOfflineDatabaseTaskInBackground,
    setOfflineDatabaseInstallLock,
} from './offlineDatabaseStorage';
import { getOfflineDatabaseApiBaseUrl, primeOfflineShellCache } from './offlineDatabaseSync';
import type { OfflineDatabaseOperations } from './offlineDatabaseOperations.shared';
import type { OfflineDatabaseOperationsArgs } from './offlineDatabaseOperations.shared';

export function useOfflineDatabaseMutations({
    applyInstalledMetadata,
    broadcast,
    instanceId,
    isSupported,
    localVersion,
    refreshOfflineDatabaseAvailability,
    remoteMetadataRef,
    remoteVersion,
    sendToWorker,
    setDbSizeBytes,
    setError,
    setIsRemoving,
    setLocalVersion,
    setProgress,
    setProgressStep,
    setRemoteVersion,
    setStatus,
    waitForOtherTabSync,
}: OfflineDatabaseOperationsArgs): Pick<
    OfflineDatabaseOperations,
    'installOfflineDatabase' | 'removeOfflineDatabase'
> {
    const installOfflineDatabase = useCallback(async () => {
        if (!isSupported) {
            throw new Error('Offline DB not supported in this browser');
        }

        const targetStatus =
            compareOfflineVersions(remoteVersion, localVersion) > 0 || localVersion !== null
                ? 'updating'
                : 'installing';

        setStatus(targetStatus);
        setProgress(0);
        setProgressStep('starting');
        setError(null);

        const currentLock = getOfflineDatabaseInstallLock();
        const lockOwner = instanceId;
        const ownsLock = !currentLock || currentLock.owner === lockOwner
            ? setOfflineDatabaseInstallLock(lockOwner)
            : false;

        if (!ownsLock) {
            setProgress(5);
            setProgressStep('waiting_for_other_tab');
            await waitForOtherTabSync();
            return;
        }

        broadcast({
            type: 'INSTALLING',
            source: lockOwner,
            payload: {
                mode: targetStatus === 'updating' ? 'updating' : 'installing',
            },
        });

        try {
            const metadata = await refreshOfflineDatabaseAvailability(true);
            if (metadata) {
                remoteMetadataRef.current = metadata;
                setRemoteVersion(metadata.version);
            }

            runOfflineDatabaseTaskInBackground(primeOfflineShellCache());

            await sendToWorker(
                {
                    type: 'INSTALL',
                    id: null,
                    payload: {
                        apiBase: getOfflineDatabaseApiBaseUrl(),
                        clerkToken: '',
                    },
                },
                600_000,
            );

            const effectiveMetadata =
                (await refreshOfflineDatabaseAvailability(true))
                || remoteMetadataRef.current
                || readStoredOfflineDatabaseMetadata();

            applyInstalledMetadata(effectiveMetadata);
            setStatus('ready');
            setProgress(100);
            setProgressStep('done');

            broadcast({
                type: 'INSTALLED',
                source: lockOwner,
                payload: { metadata: effectiveMetadata },
            });
        } catch (err) {
            const message = formatOfflineDatabaseErrorMessage(err);
            setStatus('error');
            setError(message);
            broadcast({
                type: 'ERROR',
                source: lockOwner,
                payload: { message },
            });
            throw new Error(message);
        } finally {
            clearOfflineDatabaseInstallLock(lockOwner);
        }
    }, [
        applyInstalledMetadata,
        broadcast,
        instanceId,
        isSupported,
        localVersion,
        refreshOfflineDatabaseAvailability,
        remoteMetadataRef,
        remoteVersion,
        sendToWorker,
        setError,
        setProgress,
        setProgressStep,
        setRemoteVersion,
        setStatus,
        waitForOtherTabSync,
    ]);

    const removeOfflineDatabase = useCallback(async () => {
        setIsRemoving(true);
        try {
            await sendToWorker(
                {
                    type: 'REMOVE',
                    id: null,
                    payload: {},
                },
                10_000,
            );
            persistStoredOfflineDatabaseMetadata(null);
            sessionStorage.removeItem('offline_db_seed');
            setLocalVersion(null);
            setRemoteVersion(remoteMetadataRef.current?.version ?? null);
            setDbSizeBytes(null);
            setProgress(0);
            setProgressStep('');
            setError(null);
            broadcast({
                type: 'REMOVED',
                source: instanceId,
                payload: {},
            });
        } catch (err) {
            setError(formatOfflineDatabaseErrorMessage(err));
        } finally {
            setIsRemoving(false);
        }
    }, [
        broadcast,
        instanceId,
        remoteMetadataRef,
        sendToWorker,
        setDbSizeBytes,
        setError,
        setIsRemoving,
        setLocalVersion,
        setProgress,
        setProgressStep,
        setRemoteVersion,
    ]);

    return {
        installOfflineDatabase,
        removeOfflineDatabase,
    };
}
