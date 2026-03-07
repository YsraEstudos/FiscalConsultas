export function getRestrictedUiEmails(): string[] {
    const configuredEmails = import.meta.env.VITE_RESTRICTED_UI_EMAILS;
    if (!configuredEmails) {
        return [];
    }

    return configuredEmails
        .split(',')
        .map(email => email.trim().toLowerCase())
        .filter(Boolean);
}

export function canAccessRestrictedUi(userEmail: string | null | undefined): boolean {
    const normalizedEmail = (userEmail || '').trim().toLowerCase();
    if (!normalizedEmail) {
        return false;
    }

    return getRestrictedUiEmails().includes(normalizedEmail);
}
