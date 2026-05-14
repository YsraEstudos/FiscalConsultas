/**
 * Device Fingerprint — generates a stable hash identifying the current device.
 *
 * Uses user-agent, screen dimensions, timezone, and color depth to create
 * a persistent identifier across sessions (no login/logout reset).
 */

function simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        const ch = input.charCodeAt(i);
        hash = ((hash << 5) - hash + ch) | 0;
    }
    // Convert to unsigned hex
    return (hash >>> 0).toString(16).padStart(8, '0');
}

let cachedFingerprint: string | null = null;

export function getDeviceFingerprint(): string {
    if (cachedFingerprint) return cachedFingerprint;

    const parts = [
        navigator.userAgent,
        `${screen.width}x${screen.height}`,
        `${screen.colorDepth}`,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        navigator.language,
        String(navigator.hardwareConcurrency || ''),
    ];

    cachedFingerprint = simpleHash(parts.join('|'));
    return cachedFingerprint;
}

export function getDeviceLabel(): string {
    const ua = navigator.userAgent;

    // Extract browser name + version
    let browser = 'Unknown';
    if (ua.includes('Firefox/')) {
        const match = ua.match(/Firefox\/(\d+)/);
        browser = `Firefox ${match?.[1] ?? ''}`;
    } else if (ua.includes('Edg/')) {
        const match = ua.match(/Edg\/(\d+)/);
        browser = `Edge ${match?.[1] ?? ''}`;
    } else if (ua.includes('Chrome/')) {
        const match = ua.match(/Chrome\/(\d+)/);
        browser = `Chrome ${match?.[1] ?? ''}`;
    } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
        const match = ua.match(/Version\/(\d+)/);
        browser = `Safari ${match?.[1] ?? ''}`;
    }

    // Extract OS
    let os = 'Unknown OS';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac OS')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    return `${browser.trim()} / ${os}`;
}
