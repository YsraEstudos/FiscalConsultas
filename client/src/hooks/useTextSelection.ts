import { useState, useEffect, useCallback, useRef, RefObject } from 'react';

export interface SelectionInfo {
    text: string;
    rect: DOMRect;
    anchorKey: string;
}

/**
 * Detecta seleção de texto dentro de um container específico.
 * Retorna o texto selecionado, o DOMRect da seleção e o `data-anchor-id`
 * do elemento-pai mais próximo.
 *
 * IMPORTANTE: não zera a seleção em `selectionchange` — só atualiza em
 * `mouseup`. Isso evita que clicar no botão bolha (que colapsa a seleção
 * do navegador) desmonte o Popover antes de `setOpen(true)` ser processado.
 */
export function useTextSelection(containerRef: RefObject<HTMLElement | null>) {
    const [selection, setSelection] = useState<SelectionInfo | null>(null);
    // Sinaliza que um mousedown está em andamento dentro do popover;
    // durante esse período ignoramos `selectionchange`.
    const pendingClickRef = useRef(false);

    const readSelection = useCallback((): SelectionInfo | null => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;

        const range = sel.getRangeAt(0);
        const container = containerRef.current;
        if (!container || !container.contains(range.commonAncestorContainer)) return null;

        // Sobe a árvore DOM para encontrar o data-anchor-id ou o id mais próximo
        let node: Node | null = range.commonAncestorContainer;
        let anchorKey = '';
        let fallbackId = '';
        while (node && node !== container) {
            if (node instanceof HTMLElement) {
                if (node.dataset.anchorId) {
                    anchorKey = node.dataset.anchorId;
                    break;
                }
                // Fallback: usa o id do elemento mais próximo que tenha um
                if (!fallbackId && node.id) {
                    fallbackId = node.id;
                }
            }
            node = node.parentNode;
        }
        // Se não tem data-anchor-id, usa o id como anchor_key
        if (!anchorKey && fallbackId) {
            anchorKey = fallbackId;
        }

        return {
            text: sel.toString().trim(),
            rect: range.getBoundingClientRect(),
            anchorKey,
        };
    }, [containerRef]);

    const handleMouseUp = useCallback(() => {
        // Use requestAnimationFrame for reliable selection reading after DOM update
        requestAnimationFrame(() => {
            const info = readSelection();
            if (info) {
                setSelection(info);
            } else if (!pendingClickRef.current) {
                // Só zera se não há um clique no popover em andamento
                setSelection(null);
            }
        });
    }, [readSelection]);

    useEffect(() => {
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseUp]);

    const clearSelection = useCallback(() => {
        window.getSelection()?.removeAllRanges();
        setSelection(null);
    }, []);

    /**
     * Deve ser passado como `onMouseDown` para o wrapper do Popover.
     * Sinaliza que o usuário está clicando dentro do popover para que
     * o `handleMouseUp` não zeremos a seleção prematuramente.
     */
    const onPopoverMouseDown = useCallback(() => {
        pendingClickRef.current = true;
        // Reseta após o ciclo do evento
        setTimeout(() => { pendingClickRef.current = false; }, 300);
    }, []);

    return { selection, clearSelection, onPopoverMouseDown };
}
