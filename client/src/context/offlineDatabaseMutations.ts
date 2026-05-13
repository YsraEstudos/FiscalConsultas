import { useCallback } from 'react';

import {
    compareOfflineVersions,
    formatOfflineDatabaseErrorMessage,
} from '../utils/offlineDatabase';

import {
    clearOfflineDatabaseAutoInstallOptOut,
    persistStoredOfflineDatabaseMetadata,
    persistStoredOfflineSourceMetadata,
    readStoredOfflineDatabaseMetadata,
    runOfflineDatabaseTaskInBackground,
    setOfflineDatabaseAutoInstallOptOut,
} from './offlineDatabaseStorage';
import {
    assertStaticOfflineDatabaseConfig,
    getFiscalR2BaseUrl,
    getOfflineDbPublicSeed,
    primeOfflineShellCache,
} from './offlineDatabaseSync';
import { runCoordinatedOfflineDatabaseInstall } from './offlineDatabaseInstallCoordinator';
import type { OfflineDatabaseOperations } from './offlineDatabaseOperations.shared';
import type { OfflineDatabaseOperationsArgs } from './offlineDatabaseOperations.shared';

// Published installs must use the static R2 bundle, not the legacy backend route.
const LEGACY_MONOLITHIC_BUNDLE_SOURCE = 'nesh';

export function useOfflineDatabaseMutations({
    applyInstalledMetadata,
    broadcast,
    instanceId,
    isSupported,
    localVersion,
    remoteBundleBaseUrlRef,
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
    userId,
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
        clearOfflineDatabaseAutoInstallOptOut();

        const lockOwner = instanceId;

        const runInstall = async () => {
            broadcast({
                type: 'INSTALLING',
                source: LEGACY_MONOLITHIC_BUNDLE_SOURCE,
                senderId: lockOwner,
                payload: {
                    mode: targetStatus === 'updating' ? 'updating' : 'installing',
                },
            });

            const metadata = await refreshOfflineDatabaseAvailability(true);
            if (metadata) {
                remoteMetadataRef.current = metadata;
                setRemoteVersion(metadata.version);
            }

            runOfflineDatabaseTaskInBackground(primeOfflineShellCache());
            assertStaticOfflineDatabaseConfig();

            const r2BaseUrl = remoteBundleBaseUrlRef.current || getFiscalR2BaseUrl();
            const publicSeed = getOfflineDbPublicSeed();

            if (!metadata) {
                throw new Error(
                    'Metadados R2 da base fiscal indisponíveis. Verifique os bundles estáticos e tente novamente.',
                );
            }

            const installPayload = {
                r2BaseUrl,
                publicSeed,
                metadata,
                userId: userId ?? null,
            };

            await sendToWorker(
                {
                    type: 'INSTALL',
                    id: null,
                    payload: installPayload,
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
                source: LEGACY_MONOLITHIC_BUNDLE_SOURCE,
                senderId: lockOwner,
                payload: { metadata: effectiveMetadata },
            });
        };

        try {
            await runCoordinatedOfflineDatabaseInstall({
                owner: lockOwner,
                runInstall,
                waitForPeerInstall: waitForOtherTabSync,
                onWaitingForPeer: () => {
                    setProgress(5);
                    setProgressStep('waiting_for_other_tab');
                },
            });
        } catch (err) {
            const message = formatOfflineDatabaseErrorMessage(err);
            setStatus('error');
            setError(message);
            broadcast({
                type: 'ERROR',
                source: LEGACY_MONOLITHIC_BUNDLE_SOURCE,
                senderId: lockOwner,
                payload: { message },
            });
            throw new Error(message);
        }
    }, [
        applyInstalledMetadata,
        broadcast,
        instanceId,
        isSupported,
        localVersion,
        refreshOfflineDatabaseAvailability,
        remoteBundleBaseUrlRef,
        remoteMetadataRef,
        remoteVersion,
        sendToWorker,
        setError,
        setProgress,
        setProgressStep,
        setRemoteVersion,
        setStatus,
        userId,
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
            persistStoredOfflineSourceMetadata(LEGACY_MONOLITHIC_BUNDLE_SOURCE, null);
            setOfflineDatabaseAutoInstallOptOut();
            // sessionStorage no longer stores the seed (BUG-3 fix — it was plaintext).

            setLocalVersion(null);
            setRemoteVersion(remoteMetadataRef.current?.version ?? null);
            setDbSizeBytes(null);
            setProgress(0);
            setProgressStep('');
            setError(null);
            broadcast({
                type: 'REMOVED',
                source: LEGACY_MONOLITHIC_BUNDLE_SOURCE,
                senderId: instanceId,
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
