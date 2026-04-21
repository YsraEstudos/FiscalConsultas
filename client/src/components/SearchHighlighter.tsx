import { ChevronDown, ChevronUp, Target, X } from 'lucide-react';

import styles from './SearchHighlighter.module.css';
import {
    useSearchHighlighterState,
    type SearchHighlighterProps,
} from '../useSearchHighlighterState';

export type { SearchHighlighterProps } from '../useSearchHighlighterState';

export function SearchHighlighter({
    query,
    contentContainerRef,
    isContentReady,
    isFullyRendered,
    onHighlightScrollComplete,
}: SearchHighlighterProps) {
    const {
        matches,
        terms,
        activeTerm,
        setActiveTerm,
        activeIndices,
        matchQuality,
        coOccurrenceCount,
        coOccurrenceScope,
        highSubpositionKeys,
        isVisible,
        handleNext,
        handlePrev,
        handleManualJump,
        handleClose,
    } = useSearchHighlighterState({
        query,
        contentContainerRef,
        isContentReady,
        isFullyRendered,
        onHighlightScrollComplete,
    });

    if (!isVisible || terms.length === 0) {
        return null;
    }

    const totalMatches = Object.values(matches).reduce((sum, items) => sum + items.length, 0);
    if (totalMatches === 0) {
        return null;
    }

    let qualityIcon;
    let qualityLabel;
    let qualityClass;

    if (matchQuality === 'ALTO') {
        qualityIcon = <Target size={16} className={styles.qualityAlto} />;
        qualityLabel = 'Match Alto';
        qualityClass = styles.qualityAlto;
    } else if (matchQuality === 'PEQUENO') {
        qualityIcon = <Target size={16} className={styles.qualityPequeno} />;
        qualityLabel = 'Match Pequeno';
        qualityClass = styles.qualityPequeno;
    } else {
        qualityIcon = <Target size={16} className={styles.qualityNenhum} />;
        qualityLabel = 'Matches Distantes';
        qualityClass = styles.qualityNenhum;
    }

    const coOccurrenceUnitSingular = coOccurrenceScope === 'subposition' ? 'subposição' : 'bloco';
    const coOccurrenceUnitPlural = coOccurrenceScope === 'subposition' ? 'subposições' : 'blocos';
    const coOccurrenceLabel = coOccurrenceCount === 1
        ? `1 ${coOccurrenceUnitSingular} com alta correspondência`
        : `${coOccurrenceCount} ${coOccurrenceUnitPlural} com alta correspondência`;

    const activeCount = activeTerm ? matches[activeTerm]?.length || 0 : 0;
    const activeIndex = activeTerm ? (activeIndices[activeTerm] || 0) + 1 : 0;

    return (
        <div className={styles.container}>
            {terms.length > 1 && (
                <div className={styles.matchQuality}>
                    {qualityIcon}
                    <span className={qualityClass}>
                        {qualityLabel}
                    </span>
                    <span className={styles.coOccurrenceLabel}>
                        {coOccurrenceLabel}
                    </span>
                </div>
            )}

            {highSubpositionKeys.length > 0 && (
                <div className={styles.highSubpositionJump}>
                    <select
                        className={styles.highSubpositionSelect}
                        onChange={handleManualJump}
                        defaultValue=""
                    >
                        <option value="" disabled>Ir para subposição alta...</option>
                        {highSubpositionKeys.map((id) => {
                            const cleanLabel = id.replace(/^(pos|cap|chapter)-/, '').replaceAll('-', '.');
                            return (
                                <option key={id} value={id}>
                                    Subposição {cleanLabel}
                                </option>
                            );
                        })}
                    </select>
                    <div className={styles.highLegend} title="Exibe subposições identificadas como de alta relevância">
                        <span className={styles.highLegendDot} /> Match Alto
                    </div>
                </div>
            )}

            <div className={styles.termsContainer}>
                {terms.map((term) => (
                    <button
                        type="button"
                        key={term}
                        className={`${styles.termPill} ${activeTerm === term ? styles.active : ''}`}
                        onClick={() => setActiveTerm(term)}
                    >
                        {term}
                        <span className={styles.termCount}>{matches[term]?.length || 0}</span>
                    </button>
                ))}
            </div>

            {activeTerm && activeCount > 0 && (
                <div className={styles.navigation}>
                    <span className={styles.navProgress}>
                        {activeIndex} / {activeCount}
                    </span>
                    <button
                        type="button"
                        className={styles.navButton}
                        onClick={handlePrev}
                        disabled={activeCount <= 1}
                        aria-label="Navegar para a ocorrência anterior"
                    >
                        <ChevronUp size={18} />
                    </button>
                    <button
                        type="button"
                        className={styles.navButton}
                        onClick={handleNext}
                        disabled={activeCount <= 1}
                        aria-label="Navegar para a próxima ocorrência"
                    >
                        <ChevronDown size={18} />
                    </button>
                </div>
            )}

            <button
                type="button"
                className={styles.closeButton}
                onClick={handleClose}
                aria-label="Fechar busca de página"
            >
                <X size={18} />
            </button>
        </div>
    );
}
