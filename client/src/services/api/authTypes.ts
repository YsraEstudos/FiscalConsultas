import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

export type ClerkTokenGetterOptions = {
    skipCache?: boolean;
    template?: string;
};

export type ClerkTokenGetter = (options?: ClerkTokenGetterOptions) => Promise<string | null>;

export type AuthRetryRequestConfig = InternalAxiosRequestConfig & { _retryAuth?: boolean };

export type RetryUnauthorizedResult = {
    response: AxiosResponse<unknown> | null;
    refreshAttempt: 'skipped' | 'attempted';
    refreshMode: 'fresh' | 'in_flight' | 'cooldown' | 'not_applicable';
};
