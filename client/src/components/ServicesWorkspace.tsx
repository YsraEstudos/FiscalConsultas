import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSettings } from '../context/SettingsContext';
import {
    buildNbsChapterNotesMarkup,
    lookupNbsChapterNotesEntry,
    resolveNbsChapterNumberFromCode,
} from '../utils/nbsChapterNotes';

import { NbsWorkspaceView } from './ServicesWorkspace/NbsWorkspaceView';
import { NebsWorkspaceView } from './ServicesWorkspace/NebsWorkspaceView';
import { isCodeLikeNbsQuery, renderNoteHtml } from './ServicesWorkspace/noteRendering';
import type {
    OpenCatalogDoc,
    ServicesWorkspaceProps,
} from './ServicesWorkspace/types';

export type {
    ServicesWorkspaceNebsState,
    ServicesWorkspaceNbsState,
} from './ServicesWorkspace/types';

export function ServicesWorkspace({
    doc,
    nbsState,
    nebsState,
    onSelectNbs,
    onSelectNebs,
    onSwitchDoc,
    onOpenDocInNewTab,
}: Readonly<ServicesWorkspaceProps>) {
    const nbsNoteBodyHtml = useMemo(() => renderNoteHtml(nbsState.detail?.nebs), [nbsState.detail]);
    const nebsNoteBodyHtml = useMemo(() => renderNoteHtml(nebsState.detail?.entry), [nebsState.detail]);
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
        if (!query) return;

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
            openCatalogDoc('nebs', serviceCode, forceNewTab);
        };

        container.addEventListener('mousedown', handlePointer);
        container.addEventListener('click', handlePointer);

        return () => {
            container.removeEventListener('mousedown', handlePointer);
            container.removeEventListener('click', handlePointer);
        };
    }, [openCatalogDoc]);

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

    if (doc === 'nbs') {
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

    return (
        <NebsWorkspaceView
            nebsNoteBodyHtml={nebsNoteBodyHtml}
            nebsState={nebsState}
            onSelectNebs={onSelectNebs}
            openCatalogDoc={openCatalogDoc}
        />
    );
}
