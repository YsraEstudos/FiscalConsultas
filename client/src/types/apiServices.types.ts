import type { BaseApiResponse } from './apiCommon.types';

export type ServiceDocType = 'nbs' | 'nebs';

export interface NbsCatalogItem {
    code: string;
    code_clean: string;
    description: string;
    parent_code: string | null;
    level: number;
    has_nebs: boolean;
}

/** @deprecated Use `NbsCatalogItem`. */
export type NbsServiceItem = NbsCatalogItem;

export interface NebsExplanatoryEntry {
    code: string;
    code_clean: string;
    title: string;
    body_text: string;
    body_markdown: string | null;
    title_normalized: string;
    body_normalized: string;
    section_title: string | null;
    page_start: number;
    page_end: number;
}

/** @deprecated Use `NebsExplanatoryEntry`. */
export type NebsEntry = NebsExplanatoryEntry;

export interface NebsExplanatorySearchItem {
    code: string;
    title: string;
    excerpt: string;
    page_start: number;
    page_end: number;
    section_title: string | null;
}

/** @deprecated Use `NebsExplanatorySearchItem`. */
export type NebsSearchItem = NebsExplanatorySearchItem;

export interface NbsCatalogSearchApiResponse extends BaseApiResponse {
    success: true;
    query: string;
    normalized: string;
    results: NbsCatalogItem[];
    total: number;
}

/** @deprecated Use `NbsCatalogSearchApiResponse`. */
export type NbsSearchResponse = NbsCatalogSearchApiResponse;

export interface NbsCatalogDetailApiResponse extends BaseApiResponse {
    success: true;
    item: NbsCatalogItem;
    ancestors: NbsCatalogItem[];
    children: NbsCatalogItem[];
    chapter_root?: NbsCatalogItem;
    chapter_items?: NbsCatalogItem[];
    chapter_page?: {
        items: NbsCatalogItem[];
        page: number;
        page_size: number;
        total: number;
        has_more: boolean;
    };
    nebs: NebsExplanatoryEntry | null;
}

/** @deprecated Use `NbsCatalogDetailApiResponse`. */
export type NbsDetailResponse = NbsCatalogDetailApiResponse;

export interface NebsExplanatorySearchApiResponse extends BaseApiResponse {
    success: true;
    query: string;
    normalized: string;
    results: NebsExplanatorySearchItem[];
    total: number;
}

/** @deprecated Use `NebsExplanatorySearchApiResponse`. */
export type NebsSearchResponse = NebsExplanatorySearchApiResponse;

export interface NebsExplanatoryDetailApiResponse extends BaseApiResponse {
    success: true;
    item: NbsCatalogItem;
    ancestors: NbsCatalogItem[];
    entry: NebsExplanatoryEntry;
}

/** @deprecated Use `NebsExplanatoryDetailApiResponse`. */
export type NebsDetailResponse = NebsExplanatoryDetailApiResponse;
