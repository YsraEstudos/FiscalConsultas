const CLERK_LOAD_FAILURE_PATTERNS = [
    /failed_to_load_clerk_js/i,
    /failed to load clerk js/i,
    /failed to load script: .*clerk/i,
    /clerk\.browser\.js/i,
];

function extractErrorMessage(value: unknown): string {
    if (typeof value === 'string') return value;

    if (value instanceof Error) {
        return value.message;
    }

    if (value && typeof value === 'object') {
        const candidate = value as { message?: unknown; code?: unknown; toString?: () => string };

        if (typeof candidate.message === 'string') return candidate.message;
        if (typeof candidate.code === 'string') return candidate.code;
        if (typeof candidate.toString === 'function') return candidate.toString();
    }

    return '';
}

export function isClerkLoadFailureReason(reason: unknown): boolean {
    const message = extractErrorMessage(reason);
    return CLERK_LOAD_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

export function isClerkScriptTarget(target: EventTarget | null): target is HTMLScriptElement {
    return target instanceof HTMLScriptElement
        && /clerk(\.accounts\.dev|\.com)/i.test(target.src);
}

export function getClerkUnavailableMessage(): string {
    return 'A autenticacao foi bloqueada pelo navegador, extensao ou antivirus nesta rede. O restante da busca continua disponivel, mas o login fica desativado.';
}
