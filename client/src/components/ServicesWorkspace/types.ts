import type {
    NbsCatalogDetailApiResponse,
    NbsCatalogItem,
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

export interface ServicesWorkspaceProps {
    readonly doc: ServiceDocType;
    readonly nbsState: ServicesWorkspaceNbsState;
    readonly onSelectNbs: (code: string) => void;
    readonly onSwitchDoc: (doc: ServiceDocType, query?: string) => void;
    readonly onOpenDocInNewTab?: (doc: ServiceDocType, query?: string) => void;
}

export type NoteContent = {
    readonly body_markdown?: string | null;
    readonly body_text?: string | null;
} | null | undefined;

export type OpenCatalogDoc = (
    targetDoc: ServiceDocType,
    query: string,
    forceNewTab?: boolean,
) => void;
