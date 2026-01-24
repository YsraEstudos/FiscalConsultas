import { useState, FormEvent } from 'react';
import { Modal } from './Modal';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { toast } from 'react-hot-toast';
import styles from './LoginModal.module.css';

interface LoginModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const response = await api.post('/login', { password });
            if (response.data.success) {
                login(response.data.token);
                toast.success("Login realizado!");
                onClose();
                setPassword('');
            }
        } catch (error) {
            toast.error("Senha incorreta.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Acesso Admin">
            <form onSubmit={handleSubmit} className={styles.form}>
                <p className={styles.description}>
                    Digite a senha de administrador para acessar os recursos de IA.
                </p>

                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Senha de Admin"
                    className={styles.input}
                    autoFocus
                />

                <div className={styles.actions}>
                    <button type="button" className={styles.cancelButton} onClick={onClose} disabled={loading}>
                        Cancelar
                    </button>
                    <button type="submit" className={styles.submitButton} disabled={loading}>
                        {loading ? 'Entrando...' : 'Entrar'}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
