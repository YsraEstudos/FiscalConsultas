const PRIVILEGED_ROLE_PARTS = new Set(['admin', 'owner', 'superadmin']);

export function hasPrivilegedRole(role: string | null | undefined): boolean {
    const normalized = (role || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    if (PRIVILEGED_ROLE_PARTS.has(normalized)) {
        return true;
    }

    if (!normalized.startsWith('org:')) {
        return false;
    }

    return PRIVILEGED_ROLE_PARTS.has(normalized.slice(4));
}
