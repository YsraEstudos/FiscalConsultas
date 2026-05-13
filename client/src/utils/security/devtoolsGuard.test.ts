import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('devtoolsGuard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubEnv('DEV', false);
        vi.stubEnv('VITE_API_URL', 'https://api.example.test');
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('reports the backend-supported devtools incident type once', async () => {
        vi.resetModules();
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(null, { status: 200 }));
        vi.spyOn(window, 'outerWidth', 'get').mockReturnValue(1200);
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
        vi.spyOn(window, 'outerHeight', 'get').mockReturnValue(900);
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900);

        const { installDevToolsGuard } = await import('./devtoolsGuard');
        installDevToolsGuard();

        vi.advanceTimersByTime(4_000);
        vi.advanceTimersByTime(4_000);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy).toHaveBeenCalledWith(
            'https://api.example.test/api/security/incident',
            expect.objectContaining({
                body: expect.stringContaining('"type":"devtools"'),
                method: 'POST',
            }),
        );
    });
});
