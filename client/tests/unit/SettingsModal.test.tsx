import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SettingsModal } from '../../src/../src/components/SettingsModal';
import { useSettings } from '../../src/context/SettingsContext';

// Mock the context hook
vi.mock('../../src/context/SettingsContext');

describe('SettingsModal Component', () => {
    const mockSettings = {
        theme: 'light',
        fontSize: 16,
        highlightEnabled: true,
        adminMode: false,
        updateTheme: vi.fn(),
        updateFontSize: vi.fn(),
        toggleHighlight: vi.fn(),
        toggleAdminMode: vi.fn(),
        restoreDefaults: vi.fn()
    };

    beforeEach(() => {
        vi.clearAllMocks();
        useSettings.mockReturnValue(mockSettings);
    });

    it('does not render when closed', () => {
        render(<SettingsModal isOpen={false} onClose={vi.fn()} />);
        // Modal implementation usually returns null or hidden div when open is false
        // Assuming default Modal behavior (you might need to adjust based on Modal.jsx)
        expect(screen.queryByText('Configurações')).not.toBeInTheDocument();
    });

    it('renders correctly when open', () => {
        render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
        expect(screen.getByText('Configurações')).toBeInTheDocument();
        expect(screen.getByText('Tema')).toBeInTheDocument();
        expect(screen.getByText('Tamanho da Fonte')).toBeInTheDocument();
        expect(screen.getByText('Realçar Resultados')).toBeInTheDocument();
        expect(screen.getByText('Modo Desenvolvedor')).toBeInTheDocument();
        expect(screen.getByText('Visualização TIPI')).toBeInTheDocument();
    });

    it('switches theme', () => {
        render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
        const darkBtn = screen.getByText('🌙 Escuro');
        fireEvent.click(darkBtn);
        expect(mockSettings.updateTheme).toHaveBeenCalledWith('dark');
    });

    it('updates font size', () => {
        render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: '18' } });
        expect(mockSettings.updateFontSize).toHaveBeenCalledWith(18);
    });

    it('toggles highlighting', () => {
        render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
        const toggle = screen.getByTestId('highlight-toggle');
        fireEvent.click(toggle);
        expect(mockSettings.toggleHighlight).toHaveBeenCalled();
    });

    it('toggles admin mode', () => {
        render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
        const toggle = screen.getByTestId('admin-toggle');
        fireEvent.click(toggle);
        expect(mockSettings.toggleAdminMode).toHaveBeenCalled();
    });

    it('restores defaults', () => {
        render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
        const resetBtn = screen.getByText('Restaurar Padrões');
        fireEvent.click(resetBtn);
        expect(mockSettings.restoreDefaults).toHaveBeenCalled();
    });
});
