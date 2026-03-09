import { describe, expect, it } from 'vitest';
import { hasPrivilegedRole } from './authz';

describe('hasPrivilegedRole', () => {
    it('accepts privileged roles that match backend expectations', () => {
        expect(hasPrivilegedRole('org:admin')).toBe(true);
        expect(hasPrivilegedRole('owner')).toBe(true);
        expect(hasPrivilegedRole('superadmin')).toBe(true);
    });

    it('rejects non-privileged roles', () => {
        expect(hasPrivilegedRole('org:member')).toBe(false);
        expect(hasPrivilegedRole('team:admin')).toBe(false);
        expect(hasPrivilegedRole('user:owner')).toBe(false);
        expect(hasPrivilegedRole('viewer')).toBe(false);
        expect(hasPrivilegedRole(null)).toBe(false);
    });
});
