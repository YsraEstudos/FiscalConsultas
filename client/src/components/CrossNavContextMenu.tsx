import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import styles from './CrossNavContextMenu.module.css';
import { formatNcmTipi } from '../utils/id_utils';

type DocType = 'nesh' | 'tipi';

type MenuState = {
    open: boolean;
    x: number;
    y: number;
    ncm: string;
};

const initialState: MenuState = { open: false, x: 0, y: 0, ncm: '' };

function extractNcm(raw: string): string | null {
    const text = raw.trim();
    if (!text) return null;

    // Prefer 4-digit base with dot (e.g. 8404.10, 8404.10.00)
    const dotted4 = text.match(/\b\d{4}(?:\.\d{2}){1,2}\b/);
    if (dotted4) return dotted4[0];

    // Prefer patterns with dots (e.g. 84.71, 01.01)
    const dotted = text.match(/\b\d{2}(?:\.\d{2}){1,3}\b/);
    if (dotted) return dotted[0];

    // Fallback: plain digits (e.g. 8517, 0301, 85171000)
    const digits = text.match(/\b\d{2,8}\b/);
    if (digits) return digits[0];

    return null;
}

interface CrossNavContextMenuProps {
    currentDoc: DocType;
    onOpenInDoc: (doc: DocType, ncm: string) => void;
    onOpenInNewTab: (doc: DocType, ncm: string) => void;
}

export function CrossNavContextMenu({ currentDoc, onOpenInDoc, onOpenInNewTab }: CrossNavContextMenuProps) {
    const [state, setState] = useState<MenuState>(initialState);
    const menuRef = useRef<HTMLDivElement>(null);

    const otherDoc: DocType = useMemo(() => (currentDoc === 'nesh' ? 'tipi' : 'nesh'), [currentDoc]);

    const hide = useCallback(() => setState(initialState), []);

    // Right-click handler (event delegation)
    useEffect(() => {
        const onContextMenu = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;

            const hit = target.closest(
                '.smart-link, .tipi-ncm, .tipi-result-ncm, .ncm-target, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6'
            ) as HTMLElement | null;
            if (!hit) return;

            const ncm = hit.dataset.ncm || extractNcm(hit.textContent || '');
            if (!ncm) return;

            e.preventDefault();

            // Close search history dropdown on right-click
            document.getElementById('ncmInput')?.blur();

            // Clamp inside viewport to avoid off-screen menu
            const padding = 8;
            const menuWidth = 220;
            const menuHeight = 140;
            const x = Math.min(e.clientX, window.innerWidth - menuWidth - padding);
            const y = Math.min(e.clientY, window.innerHeight - menuHeight - padding);

            setState({ open: true, x, y, ncm });
        };

        document.addEventListener('contextmenu', onContextMenu);
        return () => document.removeEventListener('contextmenu', onContextMenu);
    }, []);

    // Close on click/scroll/escape
    useEffect(() => {
        if (!state.open) return;

        const onPointerDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('[data-context-menu="true"]')) return;
            hide();
        };

        const onScroll = () => hide();

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') hide();
        };

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('scroll', onScroll, true);
        window.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [hide, state.open]);

    useEffect(() => {
        if (!state.open || !menuRef.current) return;
        menuRef.current.style.left = `${state.x}px`;
        menuRef.current.style.top = `${state.y}px`;
    }, [state.open, state.x, state.y]);

    const onCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(state.ncm);
            toast.success('NCM copiado!');
        } catch {
            toast.error('Não foi possível copiar.');
        } finally {
            hide();
        }
    }, [hide, state.ncm]);

    const onCrossNavigate = useCallback(() => {
        const targetNcm = otherDoc === 'tipi' ? formatNcmTipi(state.ncm) : state.ncm;
        onOpenInDoc(otherDoc, targetNcm);
        hide();
    }, [hide, onOpenInDoc, otherDoc, state.ncm]);

    const onOpenNewTabHere = useCallback(() => {
        const targetNcm = currentDoc === 'tipi' ? formatNcmTipi(state.ncm) : state.ncm;
        onOpenInNewTab(currentDoc, targetNcm);
        hide();
    }, [currentDoc, hide, onOpenInNewTab, state.ncm]);

    if (!state.open) return null;

    return (
        <div ref={menuRef} className={styles.menu} data-context-menu="true">
            <button className={styles.item} onClick={onCrossNavigate}>
                <span className={styles.icon}>{currentDoc === 'nesh' ? '📊' : '📖'}</span>
                Ver na {otherDoc.toUpperCase()}
            </button>
            <div className={styles.divider} />
            <button className={styles.item} onClick={onCopy}>
                <span className={styles.icon}>📋</span>
                Copiar NCM
            </button>
            <button className={styles.item} onClick={onOpenNewTabHere}>
                <span className={styles.icon}>➕</span>
                Abrir em nova aba
            </button>
        </div>
    );
}
