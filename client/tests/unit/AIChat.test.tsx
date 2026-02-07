import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIChat } from '../../src/../src/components/AIChat';
import { api } from '../../src/services/api';

// Mock dependencies
vi.mock('../../src/services/api', () => ({
    api: {
        post: vi.fn()
    }
}));

// Mock toast to avoid errors and verify calls
vi.mock('react-hot-toast', () => ({
    toast: {
        error: vi.fn()
    }
}));

describe('AIChat Component', () => {
    beforeEach(() => {
        // Mock scrollIntoView
        Element.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders as a trigger button initially', () => {
        render(<AIChat />);
        expect(screen.getByTitle('Abrir Chat IA')).toBeInTheDocument();
        expect(screen.queryByText('Assistente Nesh (IA)')).not.toBeInTheDocument();
    });

    it('opens chat window when trigger is clicked', () => {
        render(<AIChat />);
        fireEvent.click(screen.getByTitle('Abrir Chat IA'));
        expect(screen.getByText('Assistente Nesh (IA)')).toBeInTheDocument();
    });

    it('sends a message and displays response', async () => {
        api.post.mockResolvedValue({ data: { success: true, reply: 'AI Response' } });

        render(<AIChat />);
        fireEvent.click(screen.getByTitle('Abrir Chat IA'));

        const input = screen.getByPlaceholderText('Pergunte sobre NCMs...');
        fireEvent.change(input, { target: { value: 'Hello AI' } });
        fireEvent.submit(input.closest('form'));

        // Check user message immediate display
        expect(screen.getByText('Hello AI')).toBeInTheDocument();

        // Wait for AI response
        await waitFor(() => {
            expect(screen.getByText('AI Response')).toBeInTheDocument();
            expect(api.post).toHaveBeenCalledWith('/ai/chat', {
                message: 'Hello AI'
            });
        });
    });

    it('handles API error gracefully', async () => {
        api.post.mockRejectedValue(new Error('Network Error'));

        render(<AIChat />);
        fireEvent.click(screen.getByTitle('Abrir Chat IA'));

        const input = screen.getByPlaceholderText('Pergunte sobre NCMs...');
        fireEvent.change(input, { target: { value: 'Crash me' } });
        fireEvent.submit(input.closest('form'));

        await waitFor(() => {
            expect(screen.getByText(/problema de conexão/i)).toBeInTheDocument();
        });
    });

    it('disables input while loading', async () => {
        // Delay response to test loading state
        api.post.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: { success: true, reply: 'Hi' } }), 100)));

        render(<AIChat />);
        fireEvent.click(screen.getByTitle('Abrir Chat IA'));

        const input = screen.getByPlaceholderText('Pergunte sobre NCMs...');
        fireEvent.change(input, { target: { value: 'Loading test' } });
        fireEvent.submit(input.closest('form'));

        expect(input).toBeDisabled();

        await waitFor(() => {
            expect(input).not.toBeDisabled();
        });
    });
});
