export const RESTRICTED_UI_EMAIL = 'israelseja2@gmail.com';

export function canAccessRestrictedUi(userEmail: string | null | undefined): boolean {
    return (userEmail || '').trim().toLowerCase() === RESTRICTED_UI_EMAIL;
}
