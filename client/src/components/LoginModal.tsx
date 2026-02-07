import { SignIn } from '@clerk/clerk-react';
import { Modal } from './Modal';
import styles from './LoginModal.module.css';

interface LoginModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Entrar">
            <div className={styles.form}>
                <SignIn routing="virtual" />
            </div>
        </Modal>
    );
}
