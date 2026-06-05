import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureApiAuthTransport,
    registerClerkTokenGetter,
    unregisterClerkTokenGetter,
} from '../../src/services/api/authTransport';

describe('API auth transport optional telemetry auth', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        unregisterClerkTokenGetter();
    });

    it('attaches auth to telemetry when a token is available', async () => {
        registerClerkTokenGetter(vi.fn().mockResolvedValue('test-token'));
        const api = axios.create({
            adapter: async (config) => ({
                config,
                data: { authorization: config.headers?.Authorization },
                headers: {},
                status: 200,
                statusText: 'OK',
            }),
        });
        configureApiAuthTransport(api);

        const response = await api.post('/admin/search-event', {});

        expect(response.data.authorization).toBe('Bearer test-token');
    });

    it('does not force-refresh or fail telemetry when optional auth has no token', async () => {
        const getToken = vi.fn().mockResolvedValue(null);
        registerClerkTokenGetter(getToken);
        const api = axios.create({
            adapter: async (config) => ({
                config,
                data: { authorization: config.headers?.Authorization ?? null },
                headers: {},
                status: 200,
                statusText: 'OK',
            }),
        });
        configureApiAuthTransport(api);

        const response = await api.post('/admin/search-event', {});

        expect(response.data.authorization).toBeNull();
        expect(getToken).toHaveBeenCalledTimes(1);
    });
});
