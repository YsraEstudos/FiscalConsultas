import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';

import { getSystemStatus } from '../services/api';
import {
    buildServiceCatalogSnapshot,
    SERVICE_CATALOG_STATUS_TTL_MS,
    type ServiceCatalogSnapshot,
    UNKNOWN_SERVICE_CATALOG_SNAPSHOT,
} from '../utils/servicesCatalog';

function isSnapshotFresh(snapshot: ServiceCatalogSnapshot): boolean {
    if (snapshot.checkedAt === null) return false;
    return (Date.now() - snapshot.checkedAt) < SERVICE_CATALOG_STATUS_TTL_MS;
}

export function useServicesAccess() {
    const [snapshot, setSnapshot] = useState<ServiceCatalogSnapshot>(
        UNKNOWN_SERVICE_CATALOG_SNAPSHOT,
    );
    const snapshotRef = useRef(snapshot);
    const inFlightRef = useRef<Promise<ServiceCatalogSnapshot> | null>(null);

    const commitSnapshot = useCallback((next: ServiceCatalogSnapshot) => {
        snapshotRef.current = next;
        setSnapshot((current) => (
            current.availability === next.availability
            && current.checkedAt === next.checkedAt
            && current.message === next.message
        ) ? current : next);
        return next;
    }, []);

    const refreshServicesStatus = useCallback(async (force = false) => {
        const current = snapshotRef.current;
        if (!force && current.availability !== 'unknown' && isSnapshotFresh(current)) {
            return current;
        }

        if (inFlightRef.current) {
            return inFlightRef.current;
        }

        const request = getSystemStatus()
            .then((status) => commitSnapshot(buildServiceCatalogSnapshot(status)))
            .catch((error) => {
                console.warn('[useServicesAccess] Failed to refresh /api/status:', error);

                const previous = snapshotRef.current;
                if (previous.availability === 'online' && isSnapshotFresh(previous)) {
                    return previous;
                }

                if (previous.availability === 'offline' && isSnapshotFresh(previous)) {
                    return previous;
                }

                return commitSnapshot(UNKNOWN_SERVICE_CATALOG_SNAPSHOT);
            })
            .finally(() => {
                inFlightRef.current = null;
            });

        inFlightRef.current = request;
        return request;
    }, [commitSnapshot]);

    useEffect(() => {
        void refreshServicesStatus(false);
    }, [refreshServicesStatus]);

    const ensureServicesAccess = useCallback(async () => {
        const current = snapshotRef.current;
        if (current.availability === 'offline' && isSnapshotFresh(current)) {
            toast.error(current.message || 'Catálogo de serviços indisponível no momento.');
            return false;
        }

        const needsRevalidation = current.availability === 'unknown'
            || !isSnapshotFresh(current);
        const resolved = needsRevalidation
            ? await refreshServicesStatus(true)
            : current;

        if (resolved.availability === 'offline') {
            toast.error(resolved.message || 'Catálogo de serviços indisponível no momento.');
            return false;
        }

        return true;
    }, [refreshServicesStatus]);

    const ensureServicesSearchAccess = useCallback(async () => {
        const current = snapshotRef.current;
        const isOfflineAndFresh = current.availability === 'offline' && isSnapshotFresh(current);
        if (isOfflineAndFresh) {
            toast.error(current.message || 'Catálogo de serviços indisponível no momento.');
            return false;
        }

        if (current.availability === 'unknown' || !isSnapshotFresh(current)) {
            void refreshServicesStatus(false);
        }

        return true;
    }, [refreshServicesStatus]);

    return {
        ensureServicesAccess,
        ensureServicesSearchAccess,
        refreshServicesStatus,
        servicesAvailability: snapshot.availability,
        servicesUnavailableReason: snapshot.availability === 'offline' && isSnapshotFresh(snapshot)
            ? snapshot.message
            : null,
    };
}
