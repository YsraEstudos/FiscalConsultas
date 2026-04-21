import type {
    NbsCatalogDetailApiResponse,
    NbsCatalogItem,
    NebsExplanatoryDetailApiResponse,
    NebsExplanatorySearchItem,
    ServiceDocType,
} from '../../types/api.types';

export interface ServicesWorkspaceNbsState {
    readonly results: readonly NbsCatalogItem[];
    readonly selectedCode: string | null;
    readonly detail: NbsCatalogDetailApiResponse | null;
    readonly isSearching: boolean;
    readonly isLoadingDetail: boolean;
    readonly query: string;
}

export interface ServicesWorkspaceNebsState {
    readonly results: readonly NebsExplanatorySearchItem[];
    readonly selectedCode: string | null;
    readonly detail: NebsExplanatoryDetailApiResponse | null;
    readonly isSearching: boolean;
    readonly isLoadingDetail: boolean;
    readonly hasSearched: boolean;
}

export interface ServicesWorkspaceProps {
    readonly doc: ServiceDocType;
    readonly nbsState: ServicesWorkspaceNbsState;
    readonly nebsState: ServicesWorkspaceNebsState;
    readonly onSelectNbs: (code: string) => void;
    readonly onSelectNebs: (code: string) => void;
    readonly onSwitchDoc: (doc: ServiceDocType, query?: string) => void;
    readonly onOpenDocInNewTab?: (doc: ServiceDocType, query?: string) => void;
}

export type NoteContent = {
    readonly body_markdown?: string | null;
    readonly body_text?: string | null;
} | null | undefined;

export type OpenCatalogDoc = (
    targetDoc: ServiceDocType,
    query?: string,
    forceNewTab?: boolean,
) => void;
