import type { DocType } from '../hooks/useTabs';
import type { NbsSearchResponse, NebsSearchResponse } from '../types/api.types';
import styles from './ServicesTabContent.module.css';

type ServicesSearchResponse = NbsSearchResponse | NebsSearchResponse;

interface ServicesTabContentProps {
    readonly doc: DocType;
    readonly data: ServicesSearchResponse;
    readonly onSwitchDoc: (nextDoc: DocType, query: string) => void;
}

function isNbsResponse(data: ServicesSearchResponse): data is NbsSearchResponse {
    return 'results' in data && data.results.length > 0 && 'description' in data.results[0];
}

export function ServicesTabContent({ doc, data, onSwitchDoc }: Readonly<ServicesTabContentProps>) {
    if (doc === 'nbs' && isNbsResponse(data)) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <h3 className={styles.title}>Resultados NBS</h3>
                    <span className={styles.badge}>{data.total} itens</span>
                    <button
                        type="button"
                        className={styles.switchButton}
                        onClick={() => onSwitchDoc('nebs', data.query)}
                    >
                        Ver NEBS →
                    </button>
                </div>
                <div className={styles.resultsList}>
                    {data.results.map((item) => (
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

    // NEBS view
    const nebsData = data as NebsSearchResponse;
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
