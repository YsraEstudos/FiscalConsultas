import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSettings } from '../context/SettingsContext';
import {
    buildNbsChapterNotesMarkup,
    lookupNbsChapterNotesEntry,
    resolveNbsChapterNumberFromCode,
} from '../utils/nbsChapterNotes';

import { NbsWorkspaceView } from './ServicesWorkspace/NbsWorkspaceView';
import { isCodeLikeNbsQuery, renderNoteHtml } from './ServicesWorkspace/noteRendering';
import type {
    OpenCatalogDoc,
    ServicesWorkspaceProps,
} from './ServicesWorkspace/types';

export type {
    ServicesWorkspaceNbsState,
} from './ServicesWorkspace/types';

export function ServicesWorkspace({
    doc,
    nbsState,
    onSelectNbs,
    onSwitchDoc,
    onOpenDocInNewTab,
}: Readonly<ServicesWorkspaceProps>) {
    const nbsNoteBodyHtml = useMemo(() => renderNoteHtml(nbsState.detail?.nebs), [nbsState.detail]);
    const { openNewTab, nbsPrefixAutoExpand, nbsChapterNotesNewTab } = useSettings();
    const [isChapterNotesOpen, setIsChapterNotesOpen] = useState(false);
    const chapterNotesDialogRef = useRef<HTMLDialogElement | null>(null);
    const nbsNotesContentRef = useRef<HTMLDivElement | null>(null);
    const chapterCodeSource = doc === 'nbs'
        ? (nbsState.detail?.item.code || nbsState.selectedCode || (
            isCodeLikeNbsQuery(nbsState.query) ? nbsState.query : null
        ))
        : null;
    const activeChapterNumber = resolveNbsChapterNumberFromCode(chapterCodeSource);
    const currentChapterNotesEntry = lookupNbsChapterNotesEntry(chapterCodeSource);
    const chapterNotesHtml = currentChapterNotesEntry
        ? buildNbsChapterNotesMarkup(currentChapterNotesEntry)
        : '';

    const openCatalogDoc = useCallback<OpenCatalogDoc>((targetDoc, query, forceNewTab) => {
        if (!query.trim()) return;

        if ((openNewTab || forceNewTab) && onOpenDocInNewTab) {
            onOpenDocInNewTab(targetDoc, query);
            return;
        }

        onSwitchDoc(targetDoc, query);
    }, [onOpenDocInNewTab, onSwitchDoc, openNewTab]);

    useEffect(() => {
        const container = nbsNotesContentRef.current;
        if (!container) return;

        const handlePointer = (event: MouseEvent) => {
            if (event.type === 'mousedown' && event.button !== 1) {
                return;
            }

            const target = event.target;
            if (!(target instanceof Element)) return;

            const serviceLink = target.closest('.service-smart-link, .service-code-target');
            if (!(serviceLink instanceof HTMLElement) || !container.contains(serviceLink)) {
                return;
            }

            const serviceCode = serviceLink.dataset.serviceCode;
            if (!serviceCode) return;

            event.preventDefault();
            event.stopPropagation();

            const forceNewTab = event.metaKey || event.ctrlKey || event.button === 1;
            openCatalogDoc('nbs', serviceCode, forceNewTab);
        };

        container.addEventListener('mousedown', handlePointer);
        container.addEventListener('click', handlePointer);

        return () => {
            container.removeEventListener('mousedown', handlePointer);
            container.removeEventListener('click', handlePointer);
        };
    }, [nbsNoteBodyHtml, openCatalogDoc]);

    useEffect(() => {
        if (!isChapterNotesOpen || !currentChapterNotesEntry) {
            if (chapterNotesDialogRef.current?.open) {
                chapterNotesDialogRef.current.close();
            }
            return;
        }

        const dialog = chapterNotesDialogRef.current;
        if (!dialog) return;

        if (!dialog.open) {
            dialog.showModal();
        }
    }, [currentChapterNotesEntry, isChapterNotesOpen]);

    useEffect(() => {
        if (isChapterNotesOpen && !currentChapterNotesEntry) {
            setIsChapterNotesOpen(false);
        }
    }, [currentChapterNotesEntry, isChapterNotesOpen]);

    return (
        <NbsWorkspaceView
            activeChapterNumber={activeChapterNumber}
            chapterNotesDialogRef={chapterNotesDialogRef}
            chapterNotesHtml={chapterNotesHtml}
            currentChapterNotesEntry={currentChapterNotesEntry}
            nbsChapterNotesNewTab={nbsChapterNotesNewTab}
            nbsNoteBodyHtml={nbsNoteBodyHtml}
            nbsNotesContentRef={nbsNotesContentRef}
            nbsPrefixAutoExpand={nbsPrefixAutoExpand}
            nbsState={nbsState}
            onSelectNbs={onSelectNbs}
            openCatalogDoc={openCatalogDoc}
            setIsChapterNotesOpen={setIsChapterNotesOpen}
        />
    );
}
