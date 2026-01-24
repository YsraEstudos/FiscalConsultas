import { Modal } from './Modal';
import styles from './TutorialModal.module.css';

interface TutorialModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function TutorialModal({ isOpen, onClose }: TutorialModalProps) {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Como usar">
            <div className={styles.content}>
                <p><strong>🔎 Busca Inteligente:</strong><br />
                    Digite "motor" ou "8407" na barra de busca. O sistema aceita textos ou códigos NCM.</p>

                <hr className={styles.separator} />

                <p><strong>📑 Navegação por Abas:</strong><br />
                    Mantenha múltiplas consultas abertas e alterne entre elas facilmente.</p>

                <hr className={styles.separator} />

                <p><strong>📚 NESH vs TIPI:</strong><br />
                    Use os botões no topo para alternar entre as Notas Explicativas (NESH) e a Tabela de IPI (TIPI).</p>

                <hr className={styles.separator} />

                <p><strong>⌨️ Atalhos (Em breve):</strong><br />
                    <kbd>/</kbd> para focar na busca.<br />
                    <kbd>Esc</kbd> para fechar modais.</p>
            </div>
        </Modal>
    );
}
