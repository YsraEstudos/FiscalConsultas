import { useState, useRef, useEffect, FormEvent } from 'react';
import { api } from '../services/api';
import { toast } from 'react-hot-toast';
import styles from './AIChat.module.css';

interface Message {
    role: 'assistant' | 'user';
    text: string;
}

export function AIChat() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', text: 'Olá! Sou a IA do Nesh. Como posso ajudar com a classificação fiscal hoje?' }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!input.trim() || loading) return;

        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        setLoading(true);

        try {
            const response = await api.post('/ai/chat', { message: userMsg });

            if (response.data.success) {
                setMessages(prev => [...prev, { role: 'assistant', text: response.data.reply }]);
            }
        } catch (error) {
            console.error(error);
            toast.error("Erro ao comunicar com a IA.");
            setMessages(prev => [...prev, { role: 'assistant', text: "Desculpe, tive um problema de conexão. Tente novamente." }]);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) {
        return (
            <button
                className={styles.trigger}
                onClick={() => setIsOpen(true)}
                title="Abrir Chat IA"
            >
                🤖
            </button>
        );
    }

    return (
        <div className={styles.window}>
            <div className={styles.header}>
                <div className={styles.title}>
                    <span>🤖</span> Assistente Nesh (IA)
                </div>
                <button onClick={() => setIsOpen(false)} className={styles.close}>×</button>
            </div>

            <div className={styles.messages}>
                {messages.map((msg, idx) => (
                    <div
                        key={idx}
                        className={`${styles.message} ${msg.role === 'user' ? styles.messageUser : styles.messageAssistant}`}
                    >
                        <div className={`${styles.bubble} ${msg.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}`}>
                            {msg.text}
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className={`${styles.message} ${styles.messageAssistant}`}>
                        <div className={`${styles.bubble} ${styles.bubbleAssistant} ${styles.bubbleTyping}`}>
                            <span>.</span><span>.</span><span>.</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className={styles.inputArea}>
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Pergunte sobre NCMs..."
                    disabled={loading}
                    autoFocus
                />
                <button type="submit" disabled={loading || !input.trim()}>
                    ➤
                </button>
            </form>
        </div>
    );
}
