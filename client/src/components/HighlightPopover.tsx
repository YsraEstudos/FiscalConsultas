import styles from './HighlightPopover.module.css';
import type { SelectionInfo } from '../hooks/useTextSelection';

interface Props {
    selection: SelectionInfo;
    /** Pedido para abrir o painel de comentários à direita. */
    onRequestComment: () => void;
    /** Sinaliza ao hook que o clique é nosso — evita que a seleção seja zerada. */
    onPopoverMouseDown?: () => void;
}

/**
 * Botão bolha flutuante que aparece ao lado da seleção de texto.
 * Ao clicar, emite `onRequestComment` para o pai abrir o formulário
 * no painel de comentários à direita (Google Docs style).
 *
 * Posicionamento: `position: fixed` relativo à viewport.
 * Não contém formulário próprio — isso agora é responsabilidade do CommentPanel.
 */
export function HighlightPopover({ selection, onRequestComment, onPopoverMouseDown }: Props) {
    const { rect } = selection;

    // position: fixed → coordenadas são relativas à viewport (sem scrollY/scrollX)
    const top = rect.top - 48;
    const left = rect.left + rect.width / 2;

    return (
        <div
            className={styles.wrapper}
            style={{ '--popover-top': `${top}px`, '--popover-left': `${left}px` } as React.CSSProperties}
            onMouseDown={onPopoverMouseDown}
        >
            <button
                className={styles.bubble}
                onClick={onRequestComment}
                title="Adicionar comentário"
                aria-label="Adicionar comentário ao trecho selecionado"
            >
                💬
            </button>
        </div>
    );
}
