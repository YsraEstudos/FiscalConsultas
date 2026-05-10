/**
 * DevTools detection & deterrence guard.
 *
 * Detects open browser developer tools and takes defensive action
 * (logging an incident to the backend and clearing sensitive in-memory
 * data).  Only active in production builds.
 *
 * NOTE: No client-side guard is unbreakable.  This raises the bar for
 * casual inspection — a determined attacker can always disable it.
 */

const DEVTOOLS_CHECK_INTERVAL_MS = 4_000;
const RESIZE_THRESHOLD_PX = 200;

let _installed = false;
let _detected = false;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function reportIncidentToServer(type: string) {
    try {
        const endpoint =
            (import.meta.env.VITE_API_URL ?? '') + '/api/security/incident';
        void fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, ts: Date.now() }),
            keepalive: true,
        }).catch(() => {
            /* best-effort */
        });
    } catch {
        /* swallow */
    }
}

function onDevToolsDetected() {
    if (_detected) return; // fire once per session
    _detected = true;
    reportIncidentToServer('devtools_detected');
}

// ---------------------------------------------------------------------------
// Detection strategies
// ---------------------------------------------------------------------------

/**
 * 1) Window size heuristic — when DevTools is docked, the inner viewport
 *    shrinks relative to the outer window size.
 */
function checkWindowSizeAnomaly(): boolean {
    const widthDiff = window.outerWidth - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;
    return widthDiff > RESIZE_THRESHOLD_PX || heightDiff > RESIZE_THRESHOLD_PX;
}

/**
 * 2) console.log timing — DevTools intercepts console calls;
 *    on some engines the toString() of a logged object fires only when the
 *    console panel is open.
 */
function checkConsoleRedirect(): boolean {
    let opened = false;
    const el = new Image();
    Object.defineProperty(el, 'id', {
        get() {
            opened = true;
            return '';
        },
    });
    // eslint-disable-next-line no-console
    console.debug('%c', el as unknown as string);
    return opened;
}

// ---------------------------------------------------------------------------
// Keyboard / context-menu blockers
// ---------------------------------------------------------------------------

function blockDevToolsShortcuts(e: KeyboardEvent) {
    // F12
    if (e.key === 'F12') {
        e.preventDefault();
        return;
    }
    // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C  (Chrome/Edge/Firefox)
    if (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key)) {
        e.preventDefault();
        return;
    }
    // Ctrl+U  (View Source)
    if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
    }
}

function blockContextMenu(e: MouseEvent) {
    e.preventDefault();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Install the DevTools guard.  Safe to call multiple times — only the first
 * invocation has an effect.  Skipped entirely in development builds.
 */
export function installDevToolsGuard(): void {
    if (_installed) return;
    if (import.meta.env.DEV) return; // never interfere during development
    _installed = true;

    // Periodic heuristic check
    setInterval(() => {
        if (checkWindowSizeAnomaly() || checkConsoleRedirect()) {
            onDevToolsDetected();
        }
    }, DEVTOOLS_CHECK_INTERVAL_MS);

    // Keyboard shortcuts
    document.addEventListener('keydown', blockDevToolsShortcuts, {
        capture: true,
    });

    // Right-click context menu
    document.addEventListener('contextmenu', blockContextMenu, {
        capture: true,
    });
}
