/// <reference types="vite/client" />

export {};

declare module '*.module.css' {
    const classes: { [key: string]: string };
    export default classes;
}

declare module '*.css' {
    const classes: { [key: string]: string };
    export default classes;
}

declare global {
    var nesh: Window['nesh'] | undefined;
    const __APP_VERSION__: string;

    interface Window {
        nesh?: {
            smartLinkSearch: (ncm: string) => void;
            openNote: (note: string, chapter?: string) => void;
            openSettings: () => void;
            openTextResultInNewTab: (ncm: string, textQuery?: string, activate?: boolean) => void;
        };
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
        cancelIdleCallback?: (handle: number) => void;
    }
}

interface IdleDeadline {
    didTimeout: boolean;
    timeRemaining: () => number;
}

type IdleRequestCallback = (deadline: IdleDeadline) => void;

interface IdleRequestOptions {
    timeout?: number;
}
