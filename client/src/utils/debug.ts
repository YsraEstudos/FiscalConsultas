/**
 * Debug utility to prevent console noise and serialization overhead in production.
 * Only logs when import.meta.env.DEV is true.
 */
const IS_DEV = import.meta.env.DEV && import.meta.env.MODE !== 'test';

export const debug = {
    log: IS_DEV ? console.debug.bind(console) : () => { },
    error: IS_DEV ? console.error.bind(console) : () => { },
    warn: IS_DEV ? console.warn.bind(console) : () => { },
    info: IS_DEV ? console.info.bind(console) : () => { },
};

export default debug;
