export interface BaseApiResponse {
    success: boolean;
}

export interface ApiErrorDetails {
    field?: string;
    query?: string;
    resource?: string;
    identifier?: string;
    path?: string;
    service?: string;
    chapter_num?: string;
}

export interface ApiErrorResponse extends BaseApiResponse {
    success: false;
    error: {
        code: string;
        message: string;
        details?: ApiErrorDetails | null;
    };
}

export interface ChapterListItem {
    codigo: string;
    titulo: string;
    secao?: string;
}

export interface ChaptersListResponse extends BaseApiResponse {
    success: true;
    capitulos: ChapterListItem[] | string[];
}

export interface LoginResponse extends BaseApiResponse {
    success: boolean;
    token?: string;
    message: string;
}
