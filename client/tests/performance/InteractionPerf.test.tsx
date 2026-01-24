import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SearchBar } from '../../src/components/SearchBar';

describe('Interaction Performance', () => {
    it('handles input events within 100ms budget', async () => {
        const handleSearch = vi.fn();
        const mockHistory = [{ term: 'test', timestamp: Date.now() }];

        render(
            <SearchBar
                onSearch={handleSearch}
                history={mockHistory}
                onClearHistory={vi.fn()}
                onRemoveHistory={vi.fn()}
            />
        );

        const input = screen.getByPlaceholderText(/Digite os NCMs/i);
        const user = userEvent.setup();

        const start = performance.now();

        // Simulate rapid typing
        await user.type(input, '8413');

        const end = performance.now();
        const duration = end - start;

        expect(input).toHaveValue('8413');

        // Interaction budget: 100ms (RAIL model response)
        expect(duration).toBeLessThan(100);
    });
});
