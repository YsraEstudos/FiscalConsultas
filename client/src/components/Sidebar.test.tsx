import { render, screen, act } from '@testing-library/react';
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

describe('Sidebar Autoscroll', () => {
    const mockNavigate = vi.fn();
    const mockClose = vi.fn();

    const mockResults = {
        '1': {
            capitulo: '1',
            posicoes: [
                { codigo: '0101', descricao: 'Live Horses', anchor_id: '0101' },
                { codigo: '0102', descricao: 'Live Bovine', anchor_id: '0102' }
            ]
        },
        '84': {
            capitulo: '84',
            posicoes: [
                { codigo: '8417', descricao: 'Industrial Ovens', anchor_id: '8417' },
                { codigo: '8417.10', descricao: 'Furnaces', anchor_id: '8417-10' }
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

    it('scrolls to exact match NCM 8417', async () => {
        const { rerender } = render(
            <Sidebar
                results={mockResults}
                onNavigate={mockNavigate}
                isOpen={true}
                onClose={mockClose}
                searchQuery=""
            />
        );

        // Initial render should not scroll
        expect(scrollToIndexSpy).not.toHaveBeenCalled();

        // Update search query to "8417"
        // "1" Header is index 0
        // "0101" is index 1
        // "0102" is index 2
        // "84" Header is index 3
        // "8417" is index 4
        rerender(
            <Sidebar
                results={mockResults}
                onNavigate={mockNavigate}
                isOpen={true}
                onClose={mockClose}
                searchQuery="8417"
            />
        );

        // Run timers for requestAnimationFrame and timeouts
        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(scrollToIndexSpy).toHaveBeenCalledWith(expect.objectContaining({
            index: 4,
            align: 'center',
            behavior: 'auto'
        }));
    });

    it('scrolls to normalized match NCM 8417.10', async () => {
        const { rerender } = render(
            <Sidebar
                results={mockResults}
                onNavigate={mockNavigate}
                isOpen={true}
                onClose={mockClose}
                searchQuery=""
            />
        );

        // Index calculation:
        // 0: Header 1
        // 1: 0101
        // 2: 0102
        // 3: Header 84
        // 4: 8417
        // 5: 8417.10 (target)

        rerender(
            <Sidebar
                results={mockResults}
                onNavigate={mockNavigate}
                isOpen={true}
                onClose={mockClose}
                searchQuery="841710" // Unformatted input
            />
        );

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(scrollToIndexSpy).toHaveBeenCalledWith(expect.objectContaining({
            index: 5,
            align: 'center'
        }));
    });
});
