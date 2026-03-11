import React, { useState } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResultDisplay } from '../../src/components/ResultDisplay';
import { TabsBar } from '../../src/components/TabsBar';
import { TabPanel } from '../../src/components/Tabs/TabPanel';
import { SettingsProvider } from '../../src/context/SettingsContext';
import { AuthProvider } from '../../src/context/AuthContext';
import type { Tab } from '../../src/hooks/useTabs';

type TabState = {
    id: string;
    scrollTop?: number;
};

vi.mock('../../src/components/TextSearchResults', () => ({
    TextSearchResults: () => <div data-testid="text-results" />
}));

describe('Tab scroll persistence (integration)', () => {
    it('captures scroll before switch and restores on return', () => {
        const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            cb(0);
            return 0;
        });

        try {
            const TestTabs = () => {
                const [tabs, setTabs] = useState<TabState[]>([
                    { id: 'tab-1', scrollTop: 0 },
                    { id: 'tab-2', scrollTop: 0 }
                ]);
                const [activeId, setActiveId] = useState('tab-1');

                const updateTab = (tabId: string, scrollTop: number) => {
                    setTabs(prev => prev.map(tab => (tab.id === tabId ? { ...tab, scrollTop } : tab)));
                };

                return (
                    <div>
                        <button onClick={() => setActiveId('tab-1')}>Tab 1</button>
                        <button onClick={() => setActiveId('tab-2')}>Tab 2</button>

                        {tabs.map(tab => {
                            const isActive = tab.id === activeId;
                            return (
                                <div
                                    key={tab.id}
                                    data-tab-id={tab.id}
                                    style={{ display: isActive ? 'block' : 'none', height: 300 }}
                                >
                                    <ResultDisplay
                                        data={{ type: 'text', results: [1, 2, 3], query: 'test' }}
                                        mobileMenuOpen={false}
                                        onCloseMobileMenu={vi.fn()}
                                        isActive={isActive}
                                        tabId={tab.id}
                                        isNewSearch={false}
                                        onConsumeNewSearch={vi.fn()}
                                        initialScrollTop={tab.scrollTop}
                                        onPersistScroll={(id, top) => updateTab(id, top)}
                                    />
                                </div>
                            );
                        })}
                    </div>
                );
            };

            const { container, getByText } = render(
                <AuthProvider>
                    <SettingsProvider>
                        <TestTabs />
                    </SettingsProvider>
                </AuthProvider>
            );

            const tab1Scroll = container.querySelector('#results-content-tab-1') as HTMLDivElement | null;
            expect(tab1Scroll).not.toBeNull();
            if (!tab1Scroll) return;

            tab1Scroll.scrollTop = 320;
            fireEvent.scroll(tab1Scroll);

            fireEvent.click(getByText('Tab 2'));

            const tab1Pane = container.querySelector('[data-tab-id="tab-1"]') as HTMLDivElement | null;
            expect(tab1Pane).not.toBeNull();
            if (tab1Pane) {
                expect(tab1Pane.style.display).toBe('none');
            }

            fireEvent.click(getByText('Tab 1'));

            expect(tab1Scroll.scrollTop).toBe(320);
        } finally {
            rafSpy.mockRestore();
        }
    });

    it('persists scroll on rapid tab switches (NESH + TIPI)', () => {
        const originalIdle = globalThis.requestIdleCallback;
        const originalCancelIdle = globalThis.cancelIdleCallback;

        // Run idle callbacks immediately for deterministic render
        // @ts-ignore
        globalThis.requestIdleCallback = (cb: any) => globalThis.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
        // @ts-ignore
        globalThis.cancelIdleCallback = (id: number) => globalThis.clearTimeout(id);

        const TestTabs = () => {
            const [tabs, setTabs] = useState<TabState[]>([
                { id: 'tab-1', scrollTop: 0 },
                { id: 'tab-2', scrollTop: 0 }
            ]);
            const [activeId, setActiveId] = useState('tab-1');

            const updateTab = (tabId: string, scrollTop: number) => {
                setTabs(prev => prev.map(tab => (tab.id === tabId ? { ...tab, scrollTop } : tab)));
            };

            const neshData = {
                type: 'code' as const,
                markdown: '# NESH 84.17\nConteudo',
                resultados: {}
            };

            const tipiData = {
                type: 'code' as const,
                markdown: '',
                resultados: {
                    chapter1: {
                        capitulo: '01',
                        titulo: 'Capitulo 01',
                        posicoes: [
                            { codigo: '0101', ncm: '0101', descricao: 'Test', aliquota: '0', nivel: 1 }
                        ]
                    }
                }
            };

            return (
                <div>
                    <button onClick={() => setActiveId('tab-1')}>Tab 1</button>
                    <button onClick={() => setActiveId('tab-2')}>Tab 2</button>

                    {tabs.map(tab => {
                        const isActive = tab.id === activeId;
                        const data = tab.id === 'tab-1' ? neshData : tipiData;
                        return (
                            <div
                                key={tab.id}
                                data-tab-id={tab.id}
                                style={{ display: isActive ? 'block' : 'none', height: 300 }}
                            >
                                <ResultDisplay
                                    data={data}
                                    mobileMenuOpen={false}
                                    onCloseMobileMenu={vi.fn()}
                                    isActive={isActive}
                                    tabId={tab.id}
                                    isNewSearch={false}
                                    onConsumeNewSearch={vi.fn()}
                                    initialScrollTop={tab.scrollTop}
                                    onPersistScroll={(id, top) => updateTab(id, top)}
                                />
                            </div>
                        );
                    })}
                </div>
            );
        };

        const { container, getByText } = render(
            <AuthProvider>
                <SettingsProvider>
                    <TestTabs />
                </SettingsProvider>
            </AuthProvider>
        );

        const tab1Scroll = container.querySelector('#results-content-tab-1') as HTMLDivElement | null;
        const tab2Scroll = container.querySelector('#results-content-tab-2') as HTMLDivElement | null;
        expect(tab1Scroll).not.toBeNull();
        expect(tab2Scroll).not.toBeNull();
        if (!tab1Scroll || !tab2Scroll) return;

        // Rapid switches: tab1 -> tab2 -> tab1 -> tab2
        tab1Scroll.scrollTop = 210;
        fireEvent.scroll(tab1Scroll);
        fireEvent.click(getByText('Tab 2'));

        tab2Scroll.scrollTop = 420;
        fireEvent.scroll(tab2Scroll);
        fireEvent.click(getByText('Tab 1'));

        expect(tab1Scroll.scrollTop).toBe(210);
        fireEvent.click(getByText('Tab 2'));
        expect(tab2Scroll.scrollTop).toBe(420);

        globalThis.requestIdleCallback = originalIdle;
        globalThis.cancelIdleCallback = originalCancelIdle;
    });

    it('keeps the previous content position when switching tabs through TabsBar clicks', () => {
        const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            cb(0);
            return 0;
        });

        try {
            const TestTabs = () => {
                const [tabs, setTabs] = useState<Tab[]>([
                    {
                        id: 'tab-1',
                        title: 'Aba NESH',
                        document: 'nesh',
                        content: null,
                        loading: false,
                        error: null,
                        scrollTop: 0,
                        results: { type: 'text', results: [1, 2, 3], query: 'test-1' }
                    },
                    {
                        id: 'tab-2',
                        title: 'Aba TIPI',
                        document: 'tipi',
                        content: null,
                        loading: false,
                        error: null,
                        scrollTop: 0,
                        results: { type: 'text', results: [4, 5, 6], query: 'test-2' }
                    }
                ]);
                const [activeId, setActiveId] = useState('tab-1');

                const updateTab = (tabId: string, scrollTop: number) => {
                    setTabs(prev => prev.map(tab => (tab.id === tabId ? { ...tab, scrollTop } : tab)));
                };

                return (
                    <div>
                        <TabsBar
                            tabs={tabs}
                            activeTabId={activeId}
                            onSwitch={setActiveId}
                            onClose={() => { }}
                            onReorder={() => { }}
                            onNewTab={() => { }}
                        />

                        {tabs.map(tab => (
                            <TabPanel key={tab.id} id={tab.id} activeTabId={activeId}>
                                {tab.results && (
                                    <ResultDisplay
                                        data={tab.results}
                                        mobileMenuOpen={false}
                                        onCloseMobileMenu={vi.fn()}
                                        isActive={tab.id === activeId}
                                        tabId={tab.id}
                                        isNewSearch={false}
                                        onConsumeNewSearch={vi.fn()}
                                        initialScrollTop={tab.scrollTop}
                                        onPersistScroll={(id, top) => updateTab(id, top)}
                                    />
                                )}
                            </TabPanel>
                        ))}
                    </div>
                );
            };

            const { container, getByText } = render(
                <AuthProvider>
                    <SettingsProvider>
                        <TestTabs />
                    </SettingsProvider>
                </AuthProvider>
            );

            const tab1Scroll = container.querySelector('#results-content-tab-1') as HTMLDivElement | null;
            expect(tab1Scroll).not.toBeNull();
            if (!tab1Scroll) return;

            tab1Scroll.scrollTop = 275;
            fireEvent.scroll(tab1Scroll);

            fireEvent.click(getByText('Aba TIPI'));
            fireEvent.click(getByText('Aba NESH'));

            expect(tab1Scroll.scrollTop).toBe(275);
        } finally {
            rafSpy.mockRestore();
        }
    });
});
