/**
 * Debug utility — delegates to the global console, which is controlled by
 * consoleSilencer.ts (silenced for non-admin users in production, fully
 * active in development).
 *
 * In test mode all calls are suppressed to avoid noise in unit-test output.
 */
const IS_TEST = import.meta.env.MODE === 'test';
const noop = () => { };

export const debug = {
    log: IS_TEST ? noop : console.debug.bind(console),
    error: IS_TEST ? noop : console.error.bind(console),
    warn: IS_TEST ? noop : console.warn.bind(console),
    info: IS_TEST ? noop : console.info.bind(console),
};

export default debug;
