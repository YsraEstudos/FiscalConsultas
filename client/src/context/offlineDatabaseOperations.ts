import { useOfflineDatabaseMutations } from './offlineDatabaseMutations';
import { useOfflineDatabaseQueries } from './offlineDatabaseQueries';
import type { OfflineDatabaseOperationsArgs, OfflineDatabaseOperations } from './offlineDatabaseOperations.shared';

export function useOfflineDatabaseOperations(
    args: OfflineDatabaseOperationsArgs,
): OfflineDatabaseOperations {
    const mutations = useOfflineDatabaseMutations(args);
    const queries = useOfflineDatabaseQueries(args);

    return {
        ...mutations,
        ...queries,
    };
}
