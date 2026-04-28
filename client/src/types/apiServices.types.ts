import type { BaseApiResponse } from './apiCommon.types';

export type ServiceDocType = 'nbs';

export interface NbsCatalogItem {
    code: string;
    code_clean: string;
    description: string;
    parent_code: string | null;
    level: number;
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
