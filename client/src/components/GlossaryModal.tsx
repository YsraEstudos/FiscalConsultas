import { Modal } from './Modal';
import { Loading } from './Loading';
import styles from './GlossaryModal.module.css';

interface GlossaryModalProps {
    isOpen: boolean;
    onClose: () => void;
    term: string;
    definition: string | null;
    loading: boolean;
}

export function GlossaryModal({ isOpen, onClose, term, definition, loading }: GlossaryModalProps) {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Glossário: ${term || 'Consultando...'}`}>
            <div className={styles.content}>
                {loading ? (
                    <div className={styles.loadingState}>
                        <Loading size="sm" label="Buscando definição..." />
                    </div>
                ) : definition ? (
                    <div className={styles.definitionBody}>
                        <p>{definition}</p>
                        <div className={styles.glossaryFooter}>
                            Agri-Food & Customs Glossary
                        </div>
                    </div>
                ) : (
                    <p className={styles.errorText}>Definição não encontrada para "{term}".</p>
                )}
            </div>
        </Modal>
    );
}
