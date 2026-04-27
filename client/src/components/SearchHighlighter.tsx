import React from 'react';
import { ChevronDown, ChevronUp, Target, X } from 'lucide-react';

import {
    type SearchHighlighterProps,
    useSearchHighlighterState,
} from '../useSearchHighlighterState';
import styles from './SearchHighlighter.module.css';

function resolveQualityPresentation(
    matchQuality: ReturnType<typeof useSearchHighlighterState>['matchQuality'],
) {
    if (matchQuality === 'ALTO') {
        return {
            className: styles.qualityAlto,
            label: 'Match Alto',
        };
    }

    if (matchQuality === 'PEQUENO') {
        return {
            className: styles.qualityPequeno,
            label: 'Match Pequeno',
        };
    }

    return {
        className: styles.qualityNenhum,
        label: 'Matches Distantes',
    };
}

function buildCoOccurrenceLabel(
    coOccurrenceCount: number,
    coOccurrenceScope: ReturnType<typeof useSearchHighlighterState>['coOccurrenceScope'],
): string {
    const singular = coOccurrenceScope === 'subposition' ? 'subposição' : 'bloco';
    const plural = coOccurrenceScope === 'subposition' ? 'subposições' : 'blocos';

    return coOccurrenceCount === 1
        ? `1 ${singular} com alta correspondência`
        : `${coOccurrenceCount} ${plural} com alta correspondência`;
}

function formatSubpositionLabel(id: string): string {
    return id.replace(/^(pos|cap|chapter)-/, '').replaceAll('-', '.');
}

export const SearchHighlighter: React.FC<SearchHighlighterProps> = (props) => {
    const {
        activeIndices,
        activeTerm,
        coOccurrenceCount,
        coOccurrenceScope,
        handleClose,
        handleManualJump,
        handleNext,
        handlePrev,
        highSubpositionKeys,
        isVisible,
        matchQuality,
        matches,
        setActiveTerm,
        terms,
    } = useSearchHighlighterState(props);

    if (!isVisible || terms.length === 0) return null;

    const totalMatches = Object.values(matches).reduce((sum, arr) => sum + arr.length, 0);
    if (totalMatches === 0) return null;

    const quality = resolveQualityPresentation(matchQuality);
    const coOccurrenceLabel = buildCoOccurrenceLabel(
        coOccurrenceCount,
        coOccurrenceScope,
    );

    return (
        <div className={styles.container}>
            {terms.length > 1 && (
                <div className={styles.matchQuality}>
                    <Target size={16} className={quality.className} />
                    <span className={quality.className}>{quality.label}</span>
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
                        {highSubpositionKeys.map((id) => (
                            <option key={id} value={id}>
                                Subposição {formatSubpositionLabel(id)}
                            </option>
                        ))}
                    </select>
                    <div
                        className={styles.highLegend}
                        title="Exibe subposições identificadas como de alta relevância"
                    >
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

            {activeTerm && matches[activeTerm]?.length > 0 && (
                <div className={styles.navigation}>
                    <span className={styles.navProgress}>
                        {(activeIndices[activeTerm] || 0) + 1} / {matches[activeTerm].length}
                    </span>
                    <button
                        type="button"
                        className={styles.navButton}
                        onClick={handlePrev}
                        disabled={matches[activeTerm].length <= 1}
                        aria-label="Navegar para a ocorrência anterior"
                    >
                        <ChevronUp size={18} />
                    </button>
                    <button
                        type="button"
                        className={styles.navButton}
                        onClick={handleNext}
                        disabled={matches[activeTerm].length <= 1}
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
};
