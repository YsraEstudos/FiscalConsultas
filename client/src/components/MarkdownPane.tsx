import { marked } from 'marked';
import { useEffect, useRef } from 'react';
import { replaceElementWithSanitizedHtml } from '../utils/contentSecurity';

interface MarkdownPaneProps {
    markdown: string | null | undefined;
    className?: string;
}

function isFiscalResultHtml(content: string): boolean {
    const trimmed = content.trimStart();
    if (!trimmed.startsWith('<')) return false;

    return /\b(?:nesh-|tipi-|section-notas|section-consideracoes|section-definicoes)/.test(trimmed);
}

export function MarkdownPane({ markdown, className }: MarkdownPaneProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        if (!markdown) {
            containerRef.current.replaceChildren();
            return;
        }

        try {
            const rawHtml = isFiscalResultHtml(markdown) ? markdown : marked.parse(markdown) as string;
            replaceElementWithSanitizedHtml(containerRef.current, rawHtml);
        } catch (e) {
            console.error('Markdown parse error:', e);
            containerRef.current.textContent = 'Erro ao renderizar conteúdo.';
        }
    }, [markdown]);

    return <div ref={containerRef} className={className} />;
}
