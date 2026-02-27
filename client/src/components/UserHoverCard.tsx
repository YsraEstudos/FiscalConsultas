/**
 * UserHoverCard — Tooltip de perfil sobre nomes de usuários em comentários.
 *
 * Carrega dados via GET /api/profile/{userId}/card ao montar.
 * Mostra: avatar, nome, bio, contagem de comentários.
 */
import { useState, useEffect, ReactNode } from 'react';
import { getUserCard } from '../services/api';
import styles from './UserHoverCard.module.css';

interface UserHoverCardProps {
    userId: string;
    children: ReactNode;
    /** Optional image URL from Clerk (since backend can't resolve it) */
    imageUrl?: string | null;
}

interface CardData {
    user_id: string;
    full_name: string | null;
    bio: string | null;
    image_url: string | null;
    comment_count: number;
}

export function UserHoverCard({ userId, children, imageUrl }: Readonly<UserHoverCardProps>) {
    const [card, setCard] = useState<CardData | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (loaded) return;
        let cancelled = false;

        // Lazy load on first render — hover triggers via CSS
        getUserCard(userId)
            .then((data: CardData) => {
                if (!cancelled) {
                    setCard(data);
                    setLoaded(true);
                }
            })
            .catch(() => {
                if (!cancelled) setLoaded(true);
            });

        return () => { cancelled = true; };
    }, [userId, loaded]);

    const getInitials = (name: string | null) => {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    const resolvedImage = imageUrl || card?.image_url;

    return (
        <span className={styles.trigger}>
            {children}
            {card && (
                <span className={styles.cardContainer}>
                    <span className={styles.card}>
                        <span className={styles.cardHeader}>
                            {resolvedImage ? (
                                <img
                                    src={resolvedImage}
                                    alt={card.full_name || 'Avatar'}
                                    className={styles.avatar}
                                />
                            ) : (
                                <span className={styles.avatarPlaceholder}>
                                    {getInitials(card.full_name)}
                                </span>
                            )}
                            <span className={styles.name}>{card.full_name || 'Usuário'}</span>
                        </span>
                        {card.bio && <span className={styles.bio}>{card.bio}</span>}
                        <span className={styles.stat}>
                            💬 <span className={styles.statHighlight}>{card.comment_count}</span> comentários
                        </span>
                    </span>
                </span>
            )}
        </span>
    );
}
