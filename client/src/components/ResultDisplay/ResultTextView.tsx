import type React from 'react';

import type { SearchResultItem } from '../TextSearchResults';
import { TextSearchResults } from '../TextSearchResults';
import styles from '../ResultDisplay.module.css';

type ResultTextViewProps = {
    containerId: string;
    containerRef: React.RefObject<HTMLDivElement | null>;
    results: SearchResultItem[] | null;
    query: string;
};

export function ResultTextView({
    containerId,
    containerRef,
    results,
    query,
}: ResultTextViewProps) {
    return (
        <div
            className={`${styles.content} ${styles.textSearchContent}`}
            ref={containerRef}
            id={containerId}
            data-protected-fiscal
        >
            <TextSearchResults
                results={results}
                query={query}
                onResultClick={(ncm: string) => globalThis.nesh?.openTextResultInNewTab(ncm, query)}
                scrollParentRef={containerRef}
            />
        </div>
    );
}
