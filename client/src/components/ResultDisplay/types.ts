import type React from 'react';

import type { ChapterBodyResponse } from '../../types/api.types';
import type { SearchResultItem } from '../TextSearchResults';

export type ResultRecord = Record<string, any>;
export type ChapterSectionType = 'titulo' | 'notas' | 'consideracoes' | 'definicoes';

export interface ResultData {
    type?: 'text' | 'code';
    markdown?: string;
    ncm?: string;
    query?: string;
    results?: SearchResultItem[] | ResultRecord;
    resultados?: ResultRecord;
}

export interface ResultDisplayProps {
    data: ResultData | null;
    mobileMenuOpen: boolean;
    onCloseMobileMenu: () => void;
    onToggleMobileMenu?: () => void;
    isActive: boolean;
    tabId: string;
    initialScrollTop?: number;
    onPersistScroll?: (tabId: string, scrollTop: number) => void;
    latestTextQuery?: string;
    isNewSearch: boolean;
    onConsumeNewSearch: (tabId: string, finalScrollTop?: number) => void;
    onContentReady?: (tabId: string) => void;
    onHydratedResults?: (tabId: string, results: ResultRecord) => void;
}

export type MarkupRenderRefs = {
    contentRef: React.RefObject<HTMLDivElement | null>;
    renderedMarkupKeyRef: React.MutableRefObject<string | null>;
    lastMarkupRef: React.MutableRefObject<string | null>;
    lastHtmlRef: React.MutableRefObject<string | null>;
};

export type MarkupRenderOptions = {
    rawMarkdown: string;
    markupToRender: string;
    isActive: boolean;
    isContentReady: boolean;
    refs: MarkupRenderRefs;
    setIsContentReady: React.Dispatch<React.SetStateAction<boolean>>;
    setIsFullyRendered: React.Dispatch<React.SetStateAction<boolean>>;
};

export type ChapterHydrationResult = {
    chapterBodies: ChapterBodyResponse[];
    failedChapters: string[];
};
