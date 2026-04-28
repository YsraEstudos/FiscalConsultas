import DOMPurify from 'dompurify';
import { marked } from 'marked';

import { injectServiceLinks } from '../../utils/serviceCodes';

import type { NoteContent, ServicesWorkspaceNbsState } from './types';

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function renderPlainTextNoteHtml(noteBody: string): string {
    const normalizedBody = noteBody.replaceAll(/\r\n?/g, '\n');

    return normalizedBody
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br />')}</p>`)
        .join('');
}

export function renderNoteHtml(note: NoteContent): string {
    const markdownBody = note?.body_markdown?.trim();
    if (markdownBody) {
        const renderedMarkdown = marked.parse(markdownBody, {
            async: false,
            breaks: true,
            gfm: true,
        });

        const sanitizedMarkdown = DOMPurify.sanitize(renderedMarkdown, {
            USE_PROFILES: { html: true },
        });

        if (sanitizedMarkdown.trim()) {
            return injectServiceLinks(sanitizedMarkdown);
        }
    }

    const plainTextBody = note?.body_text?.trim();
    if (!plainTextBody) {
        return '<p>Sem conteudo detalhado.</p>';
    }

    return injectServiceLinks(DOMPurify.sanitize(renderPlainTextNoteHtml(plainTextBody), {
        USE_PROFILES: { html: true },
    }));
}

export function isCodeLikeNbsQuery(query: string): boolean {
    const rawQuery = query.trim();
    if (!rawQuery) return false;

    const cleanQuery = rawQuery.replaceAll(/[^0-9.]/g, '');
    return Boolean(cleanQuery) && [...rawQuery].every(
        (character) => (character >= '0' && character <= '9') || character === '.',
    );
}

export function getExpandedPrefixBranch(
    results: readonly ServicesWorkspaceNbsState['results'][number][],
    query: string,
    activeCode: string,
) {
    const cleanQuery = query.replaceAll(/[^0-9]/g, '');
    if (!cleanQuery) return [];

    return results.filter((item) => (
        item.code !== activeCode
        && item.code_clean.startsWith(cleanQuery)
    ));
}
