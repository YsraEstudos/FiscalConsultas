export interface AuthSessionResponse {
    authenticated: boolean;
    can_use_ai_chat?: boolean;
    can_use_restricted_ui?: boolean;
}

export interface GlossaryTermDefinition {
    definition: string;
    source?: string;
}

export interface GlossaryTermApiResponse {
    found: boolean;
    term: string;
    data?: GlossaryTermDefinition;
}

/** @deprecated Use `GlossaryTermApiResponse`. */
export type GlossaryResponse = GlossaryTermApiResponse;

export interface DatabaseStatus {
    status: 'online' | 'error';
    chapters?: number;
    positions?: number;
    latency_ms?: number;
    items?: number;
    entries?: number;
    metadata?: Record<string, string>;
    error?: string;
}

export interface SystemCatalogStatus {
    status: 'online' | 'error';
    latency_ms?: number;
}

export interface SystemStatusResponse {
    status: 'online' | 'error';
    version?: string;
    backend?: string;
    database: DatabaseStatus;
    tipi: DatabaseStatus;
    nbs?: DatabaseStatus;
    catalogs?: {
        nesh: SystemCatalogStatus;
        tipi: SystemCatalogStatus;
        nbs: SystemCatalogStatus;
    };
}
