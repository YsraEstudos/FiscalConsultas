import { describe, expect, it, vi } from 'vitest';
import {
    getServiceCatalogErrorInfo,
    getServiceCatalogErrorMessage,
    reportServiceCatalogError,
} from './servicesCatalog';

describe('servicesCatalog error handling', () => {
    it('returns a generic outage message with support request id for 401 responses', () => {
        const error = {
            isAxiosError: true,
            response: {
                status: 401,
                data: { detail: 'Tenant não identificado' },
                headers: { 'x-request-id': 'req-401-test' },
            },
            config: { url: '/services/nbs/search?q=121' },
        };

        const resolved = getServiceCatalogErrorInfo(error, 'nbs');

        expect(resolved.status).toBe(401);
        expect(resolved.requestId).toBe('req-401-test');
        expect(resolved.detail).toBe('Tenant não identificado');
        expect(resolved.message).toContain('Catálogo de serviços indisponível no momento.');
        expect(resolved.message).toContain('Codigo de suporte: req-401-test.');
        expect(getServiceCatalogErrorMessage(error, 'nbs')).toBe(resolved.message);
    });

    it('logs catalog failures with request id for support follow-up', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const error = {
            isAxiosError: true,
            response: {
                status: 403,
                data: { detail: 'Forbidden' },
                headers: { 'x-request-id': 'req-403-test' },
            },
            config: { url: '/services/nbs/search?q=energia' },
        };

        reportServiceCatalogError(error, 'nbs');

        expect(warnSpy).toHaveBeenCalledWith(
            '[servicesCatalog] Public catalog route failed',
            expect.objectContaining({
                doc: 'nbs',
                status: 403,
                requestId: 'req-403-test',
                detail: 'Forbidden',
                url: '/services/nbs/search?q=energia',
            }),
        );

        warnSpy.mockRestore();
    });
});
