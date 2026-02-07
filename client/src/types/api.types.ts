// ============================================
// API Response Types — Nesh/Fiscal
// ============================================
// Interfaces TypeScript para todas as respostas da API.
// Garante type-safety no frontend e evita erros de runtime.

// --------------------------------------------
// Base Types
// --------------------------------------------

/** Base para todas as respostas da API */
export interface BaseApiResponse {
    success: boolean;
}

/** Resposta de erro padronizada do backend */
export interface ApiErrorResponse extends BaseApiResponse {
    success: false;
    error: {
        code: string;
        message: string;
        details?: {
            field?: string;
            query?: string;
            resource?: string;
            identifier?: string;
            path?: string;
            service?: string;
            chapter_num?: string;
        } | null;
    };
}

// --------------------------------------------
// NESH Search Types
// --------------------------------------------

/** Item de resultado de busca textual (FTS) */
export interface TextSearchResultItem {
    ncm: string;
    descricao: string;
    tipo: 'chapter' | 'position' | 'subposition';
    relevancia: number;
    score: number;
    tier: 1 | 2 | 3;
    tier_label: 'Exato' | 'Todas palavras' | 'Parcial';
    near_bonus?: boolean;
}

/** Resposta de busca textual NESH */
export interface TextSearchResponse extends BaseApiResponse {
    success: true;
    type: 'text';
    query: string;
    normalized: string;
    match_type: 'exact' | 'all_words' | 'partial' | 'none' | 'error';
    warning: string | null;
    results: TextSearchResultItem[];
    total_capitulos: number;
}

/** Posição NCM dentro de um capítulo */
export interface ChapterPosition {
    ncm?: string;
    codigo: string;
    descricao: string;
    anchor_id: string;
    // TIPI-specific (optional for NESH)
    aliquota?: string;
    nivel?: number;
}

/** Seções estruturadas do capítulo */
export interface ChapterSections {
    titulo: string | null;
    notas: string | null;
    consideracoes: string | null;
    definicoes: string | null;
}

/** Dados de um capítulo NESH */
export interface ChapterData {
    ncm_buscado: string;
    capitulo: string;
    posicao_alvo: string | null;
    posicoes: ChapterPosition[];
    notas_gerais: string | null;
    notas_parseadas: Record<string, string>;
    conteudo: string;
    real_content_found: boolean;
    erro: string | null;
    secoes?: ChapterSections;
}

/** Resposta de busca por código NESH */
export interface CodeSearchResponse extends BaseApiResponse {
    success: true;
    type: 'code';
    query: string;
    normalized: null;
    results: Record<string, ChapterData>;
    resultados?: Record<string, ChapterData>; // Legacy alias
    total_capitulos: number;
    markdown?: string; // Rendered HTML
}

/** Union type para resposta de busca NESH */
export type NeshSearchResponse = TextSearchResponse | CodeSearchResponse;

// --------------------------------------------
// TIPI Search Types
// --------------------------------------------

/** Posição TIPI com alíquota */
export interface TipiPosition {
    ncm: string;
    codigo: string;
    descricao: string;
    aliquota: string;
    nivel: number;
    anchor_id: string;
}

/** Capítulo TIPI */
export interface TipiChapterData {
    capitulo: string;
    titulo: string;
    notas_gerais: string | null;
    posicao_alvo: string | null;
    posicoes: TipiPosition[];
}

/** Resposta de busca TIPI por código */
export interface TipiCodeSearchResponse extends BaseApiResponse {
    success: true;
    type: 'code';
    query: string;
    results: Record<string, TipiChapterData>;
    resultados: Record<string, TipiChapterData>;
    total: number;
    total_capitulos: number;
    markdown?: string;
}

/** Item de resultado de busca textual TIPI */
export interface TipiTextResultItem {
    ncm: string;
    capitulo: string;
    descricao: string;
    aliquota: string;
}

/** Resposta de busca TIPI textual */
export interface TipiTextSearchResponse extends BaseApiResponse {
    success: true;
    type: 'text';
    query: string;
    normalized: string;
    match_type: string;
    warning: string | null;
    total: number;
    results: TipiTextResultItem[];
}

/** Union type para resposta de busca TIPI */
export type TipiSearchResponse = TipiCodeSearchResponse | TipiTextSearchResponse;

/** Union genérico para qualquer resposta de busca */
export type SearchResponse = NeshSearchResponse | TipiSearchResponse;

// --------------------------------------------
// Other Endpoints
// --------------------------------------------

/** Resposta do glossário */
export interface GlossaryResponse {
    found: boolean;
    term: string;
    data?: {
        definition: string;
        source?: string;
    };
}

/** Capítulo na lista de capítulos */
export interface ChapterListItem {
    codigo: string;
    titulo: string;
    secao?: string;
}

/** Resposta de lista de capítulos */
export interface ChaptersListResponse extends BaseApiResponse {
    success: true;
    capitulos: ChapterListItem[] | string[];
}

/** Status do banco de dados */
export interface DatabaseStatus {
    status: 'online' | 'error';
    chapters?: number;
    positions?: number;
    latency_ms?: number;
    error?: string;
}

/** Status do sistema */
export interface SystemStatusResponse {
    status: 'online' | 'error';
    version: string;
    backend: string;
    database: DatabaseStatus;
    tipi: DatabaseStatus;
}

/** Login response */
export interface LoginResponse extends BaseApiResponse {
    success: boolean;
    token?: string;
    message: string;
}

// --------------------------------------------
// Type Guards
// --------------------------------------------

/** Verifica se a resposta é de busca textual */
export function isTextSearchResponse(
    response: NeshSearchResponse | TipiSearchResponse
): response is TextSearchResponse | TipiTextSearchResponse {
    return response.type === 'text';
}

/** Verifica se a resposta é de busca por código */
export function isCodeSearchResponse(
    response: NeshSearchResponse | TipiSearchResponse
): response is CodeSearchResponse | TipiCodeSearchResponse {
    return response.type === 'code';
}

/** Verifica se a resposta é um erro da API */
export function isApiError(response: unknown): response is ApiErrorResponse {
    return (
        typeof response === 'object' &&
        response !== null &&
        'success' in response &&
        (response as BaseApiResponse).success === false &&
        'error' in response
    );
}
