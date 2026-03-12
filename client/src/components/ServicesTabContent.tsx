import type { DocType } from '../hooks/useTabs';
import {
    isNebsSearchResponse,
    isNbsSearchResponse,
    type NbsSearchResponse,
    type NebsSearchResponse,
} from '../types/api.types';
import styles from './ServicesTabContent.module.css';

type ServicesSearchResponse = NbsSearchResponse | NebsSearchResponse;

interface ServicesTabContentProps {
    readonly doc: DocType;
    readonly data: ServicesSearchResponse;
    readonly onSwitchDoc: (nextDoc: DocType, query: string) => void;
}

export function ServicesTabContent({ doc, data, onSwitchDoc }: Readonly<ServicesTabContentProps>) {
    if (doc === 'nbs' && isNbsSearchResponse(data)) {
        const nbsData = data;

        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <h3 className={styles.title}>Resultados NBS</h3>
                    <span className={styles.badge}>{nbsData.total} itens</span>
                    <button
                        type="button"
                        className={styles.switchButton}
                        onClick={() => onSwitchDoc('nebs', nbsData.query)}
                    >
                        Ver NEBS →
                    </button>
                </div>
                <div className={styles.resultsList}>
                    {nbsData.results.map((item) => (
                        <div key={item.code} className={styles.resultCard}>
                            <div className={styles.resultMeta}>
                                <span className={styles.codeBadge}>{item.code}</span>
                                {item.has_nebs && <span className={styles.nebsBadge}>NEBS</span>}
                                <span className={styles.levelHint}>Nível {item.level}</span>
                            </div>
                            <strong>{item.description}</strong>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (!isNebsSearchResponse(data)) {
        return null;
    }

    // NEBS view
    const nebsData = data;
    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h3 className={styles.title}>Resultados NEBS</h3>
                <span className={styles.badge}>{nebsData.total} notas</span>
                <button
                    type="button"
                    className={styles.switchButton}
                    onClick={() => onSwitchDoc('nbs', nebsData.query)}
                >
                    ← Ver NBS
                </button>
            </div>
            <div className={styles.resultsList}>
                {nebsData.results.map((item) => (
                    <div key={item.code} className={styles.resultCard}>
                        <div className={styles.resultMeta}>
                            <span className={styles.codeBadge}>{item.code}</span>
                            {item.section_title && (
                                <span className={styles.sectionBadge}>{item.section_title}</span>
                            )}
                        </div>
                        <strong>{item.title}</strong>
                        <p className={styles.excerpt}>{item.excerpt}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}
