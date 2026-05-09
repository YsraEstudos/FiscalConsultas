import { describe, expect, it } from 'vitest';

import { getOfflineChannelSenderId } from '../../src/context/offlineDatabaseRuntime/useOfflineDatabaseBroadcastChannel';

describe('offline database broadcast channel migration', () => {
  it('reads senderId from new messages and source from legacy messages', () => {
    expect(getOfflineChannelSenderId({
      type: 'INSTALLING',
      source: 'nesh',
      senderId: 'new-tab',
      payload: { mode: 'installing' },
    })).toBe('new-tab');

    expect(getOfflineChannelSenderId({
      type: 'INSTALLING',
      source: 'legacy-tab',
      payload: { mode: 'installing' },
    } as any)).toBe('legacy-tab');
  });
});
