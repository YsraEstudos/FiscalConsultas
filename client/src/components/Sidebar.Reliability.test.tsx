import { render, act } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

// Global spy for scrollToIndex
const scrollToIndexSpy = vi.fn();

// Mock react-virtuoso
vi.mock('react-virtuoso', async () => {
    const React = await import('react');
    return {
        Virtuoso: React.forwardRef(({ data, itemContent }: any, ref: any) => {
            React.useImperativeHandle(ref, () => ({
                scrollToIndex: scrollToIndexSpy,
            }));

            return (
                <div data-testid="virtuoso-list">
                    {data.map((item: any, index: number) => (
                        <div key={index} data-testid="virtuoso-item">
                            {itemContent(index, item)}
                        </div>
                    ))}
                </div>
            );
        })
    };
});

describe('Sidebar Reliability Reproduction', () => {
    const mockNavigate = vi.fn();
    const mockClose = vi.fn();

    // Mock data mimicking the user's scenario
    const mockResults = {
        '49': {
            capitulo: '49',
            posicoes: [
                { codigo: '4908', descricao: 'Decalcomanias', anchor_id: 'pos-49-08' },
                { codigo: '4909', descricao: 'Cartões postais', anchor_id: 'pos-49-09' }
            ]
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('Scenario 1: Search for 4908.90.00 must scroll to 4908, NOT 4909', async () => {
        const { rerender } = render(
            <Sidebar
                results={mockResults}
                onNavigate={mockNavigate}
                isOpen={true}
                onClose={mockClose}
                searchQuery=""
            />
        );

        // Index mapping:
        // 0: Header 49
        // 1: 4908
        // 2: 4909

        // Search for specific NCM that doesn't exist as a position key, but belongs to 4908
        rerender(
            <Sidebar
                results={mockResults}
                onNavigate={mockNavigate}
                isOpen={true}
                onClose={mockClose}
                searchQuery="4908.90.00"
            />
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        // Current bug expectation: It might be scrolling to index 2 (4909) or failing
        // Correct expectation: Index 1 (4908)

        // We verify what it actually did. If this test passes with index 1, then I failed to reproduce.
        // If it was called with index 2, reproduction successful.

        const calls = scrollToIndexSpy.mock.calls;
        const lastCall = calls[calls.length - 1];

        // Assert it was called
        expect(scrollToIndexSpy).toHaveBeenCalled();

        // Assert correct index (this mimics the "Fix", so if it currently fails, it means the code is bugged)
        expect(lastCall[0].index).toBe(1);
    });

    it('Scenario 2: Intermittent scroll - ensure robust fallback', async () => {
        // This tests if the component handles cases where normalizeNCMQuery returns something 
        // that isn't in the index, ensuring it doesn't crash or random scroll.
        const { rerender } = render(
            <Sidebar
                results={mockResults}
                onNavigate={mockNavigate}
                isOpen={true}
                onClose={mockClose}
                searchQuery=""
            />
        );

        rerender(
            <Sidebar
                results={mockResults}
                onNavigate={mockNavigate}
                isOpen={true}
                onClose={mockClose}
                searchQuery="9999.00.00" // Non-existent
            />
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        // Should NOT scroll
        expect(scrollToIndexSpy).not.toHaveBeenCalled();
    });
});
