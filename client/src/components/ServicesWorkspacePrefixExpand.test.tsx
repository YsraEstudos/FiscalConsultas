import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { STORAGE_KEYS } from '../constants';
import { SettingsProvider } from '../context/SettingsContext';
import { ServicesWorkspace, type ServicesWorkspaceNebsState, type ServicesWorkspaceNbsState } from './ServicesWorkspace';

function makeItem(code: string, description: string, level: number) {
    return {
        code,
        code_clean: code.replaceAll('.', ''),
        description,
        parent_code: null,
        level,
        has_nebs: false,
    };
}

const EMPTY_NEBS_STATE: ServicesWorkspaceNebsState = {
    results: [],
    selectedCode: null,
    detail: null,
    isSearching: false,
    isLoadingDetail: false,
    hasSearched: false,
};

function renderWorkspace(nbsState: ServicesWorkspaceNbsState) {
    return render(
        <SettingsProvider>
            <ServicesWorkspace
                doc="nbs"
                nbsState={nbsState}
                nebsState={EMPTY_NEBS_STATE}
                onSelectNbs={vi.fn()}
                onSelectNebs={vi.fn()}
                onSwitchDoc={vi.fn()}
            />
        </SettingsProvider>,
    );
}

describe('ServicesWorkspace prefix expansion', () => {
    it('shows the full branch for code-like prefix searches when the setting is enabled', () => {
        localStorage.setItem(STORAGE_KEYS.NBS_PREFIX_AUTO_EXPAND, 'true');

        renderWorkspace({
            results: [
                makeItem('1.0601', 'Serviços de manuseio de cargas', 1),
                makeItem('1.0601.10.00', 'Serviços de manuseio de contêineres', 3),
                makeItem('1.0601.90.00', 'Serviços de manuseio de cargas não classificados em subposições anteriores', 3),
                makeItem('1.0602', 'Serviços de armazenagem', 1),
                makeItem('1.0602.10.00', 'Serviços de armazenagem frigorificada', 3),
            ],
            selectedCode: '1.0601',
            detail: {
                success: true,
                item: makeItem('1.0601', 'Serviços de manuseio de cargas', 1),
                ancestors: [],
                children: [],
                nebs: null,
            },
            isSearching: false,
            isLoadingDetail: false,
            query: '1.06',
        });

        expect(screen.getByText('1.0601.10.00 - Serviços de manuseio de contêineres')).toBeInTheDocument();
        expect(screen.getByText('1.0601.90.00 - Serviços de manuseio de cargas não classificados em subposições anteriores')).toBeInTheDocument();
        expect(screen.getByText('1.0602 - Serviços de armazenagem')).toBeInTheDocument();
        expect(screen.getByText('1.0602.10.00 - Serviços de armazenagem frigorificada')).toBeInTheDocument();
    });
});
