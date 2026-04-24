import type { BaseApiResponse } from './apiCommon.types';

export interface NeshTextSearchResultItem {
    ncm: string;
    descricao: string;
    tipo: 'chapter' | 'position' | 'subposition';
    relevancia: number;
    score: number;
    tier: 1 | 2 | 3;
    tier_label: 'Exato' | 'Todas palavras' | 'Parcial';
    near_bonus?: boolean;
}

export type TextSearchResultItem = NeshTextSearchResultItem;

export interface NeshTextSearchApiResponse extends BaseApiResponse {
    success: true;
    type: 'text';
    query: string;
    normalized: string;
    match_type: 'exact' | 'all_words' | 'partial' | 'none' | 'error';
    warning: string | null;
    results: NeshTextSearchResultItem[];
    total_capitulos: number;
}

/** @deprecated Use `NeshTextSearchApiResponse`. */
export type TextSearchResponse = NeshTextSearchApiResponse;

export interface NeshChapterPosition {
    ncm?: string;
    codigo: string;
    descricao: string;
    anchor_id: string;
    aliquota?: string;
    nivel?: number;
}

export type ChapterPosition = NeshChapterPosition;

export interface NeshChapterSections {
    titulo: string | null;
    notas: string | null;
    consideracoes: string | null;
    definicoes: string | null;
}

export type ChapterSections = NeshChapterSections;

export interface NeshChapterData {
    ncm_buscado: string;
    capitulo: string;
    posicao_alvo: string | null;
    posicoes: NeshChapterPosition[];
    notas_gerais: string | null;
    notas_parseadas: Record<string, string>;
    conteudo: string;
    real_content_found: boolean;
    erro: string | null;
    secoes?: NeshChapterSections;
}

export type ChapterData = NeshChapterData;

export interface NeshCodeSearchApiResponse extends BaseApiResponse {
    success: true;
    type: 'code';
    query: string;
    normalized: null;
    results: Record<string, NeshChapterData>;
    resultados?: Record<string, NeshChapterData>;
    total_capitulos: number;
    markdown?: string;
}

/** @deprecated Use `NeshCodeSearchApiResponse`. */
export type CodeSearchResponse = NeshCodeSearchApiResponse;

export interface NeshChapterBodyApiResponse extends BaseApiResponse {
    success: true;
    capitulo: string;
    conteudo: string;
    notas_parseadas: Record<string, string>;
    notas_gerais: string | null;
    secoes?: NeshChapterSections | null;
}

export type ChapterBodyResponse = NeshChapterBodyApiResponse;

export interface NeshChapterNotesApiResponse extends BaseApiResponse {
    success: boolean;
    capitulo: string;
    notas_parseadas: Record<string, string>;
    notas_gerais: string | null;
}

export type NeshSearchApiResponse =
    | NeshTextSearchApiResponse
    | NeshCodeSearchApiResponse;

export interface TipiPosition {
    ncm: string;
    codigo: string;
    descricao: string;
    aliquota: string;
    nivel: number;
    anchor_id: string;
}

export interface TipiChapterData {
    capitulo: string;
    titulo: string;
    notas_gerais: string | null;
    posicao_alvo: string | null;
    posicoes: TipiPosition[];
}

export interface TipiCodeSearchApiResponse extends BaseApiResponse {
    success: true;
    type: 'code';
    query: string;
    results: Record<string, TipiChapterData>;
    resultados?: Record<string, TipiChapterData>;
    total: number;
    total_capitulos: number;
    markdown?: string;
}

/** @deprecated Use `TipiCodeSearchApiResponse`. */
export type TipiCodeSearchResponse = TipiCodeSearchApiResponse;

export interface TipiTextSearchResultItem {
    ncm: string;
    capitulo: string;
    descricao: string;
    aliquota: string;
}

export type TipiTextResultItem = TipiTextSearchResultItem;

export interface TipiTextSearchApiResponse extends BaseApiResponse {
    success: true;
    type: 'text';
    query: string;
    normalized: string;
    match_type: string;
    warning: string | null;
    total: number;
    results: TipiTextSearchResultItem[];
}

/** @deprecated Use `TipiTextSearchApiResponse`. */
export type TipiTextSearchResponse = TipiTextSearchApiResponse;

export type TipiSearchApiResponse =
    | TipiCodeSearchApiResponse
    | TipiTextSearchApiResponse;
