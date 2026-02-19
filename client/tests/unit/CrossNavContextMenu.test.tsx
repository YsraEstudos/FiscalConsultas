import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CrossNavContextMenu } from '../../src/components/CrossNavContextMenu';


const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}));


describe('CrossNavContextMenu', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
    const clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: clipboard,
      configurable: true,
    });
  });

  it('opens on valid ncm target, clamps position and navigates to other doc', async () => {
    const onOpenInDoc = vi.fn();
    const onOpenInNewTab = vi.fn();
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });

    render(
      <>
        <input id="ncmInput" defaultValue="8517" />
        <span className="smart-link" data-ncm="85171300">NCM 8517.13.00</span>
        <CrossNavContextMenu
          currentDoc="nesh"
          onOpenInDoc={onOpenInDoc}
          onOpenInNewTab={onOpenInNewTab}
        />
      </>,
    );

    const input = document.getElementById('ncmInput') as HTMLInputElement;
    const blurSpy = vi.spyOn(input, 'blur');
    fireEvent.contextMenu(screen.getByText('NCM 8517.13.00'), { clientX: 5000, clientY: 4000 });

    const openButton = await screen.findByText('Ver na TIPI');
    const menu = openButton.closest('[data-context-menu="true"]') as HTMLDivElement;

    expect(blurSpy).toHaveBeenCalled();
    expect(menu.style.left).toBe('772px');
    expect(menu.style.top).toBe('452px');

    fireEvent.click(openButton);
    expect(onOpenInDoc).toHaveBeenCalledWith('tipi', '8517.13.00');
  });

  it('copies ncm to clipboard and handles copy failure with toast', async () => {
    const onOpenInDoc = vi.fn();
    const onOpenInNewTab = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(
      <>
        <span className="tipi-ncm">84.71 - Computadores</span>
        <CrossNavContextMenu
          currentDoc="nesh"
          onOpenInDoc={onOpenInDoc}
          onOpenInNewTab={onOpenInNewTab}
        />
      </>,
    );

    fireEvent.contextMenu(screen.getByText('84.71 - Computadores'), { clientX: 120, clientY: 120 });
    fireEvent.click(await screen.findByText('Copiar NCM'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('84.71');
      expect(toastSuccess).toHaveBeenCalledWith('NCM copiado!');
    });

    writeText.mockRejectedValueOnce(new Error('copy failed'));
    fireEvent.contextMenu(screen.getByText('84.71 - Computadores'), { clientX: 120, clientY: 120 });
    fireEvent.click(await screen.findByText('Copiar NCM'));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Não foi possível copiar.');
    });
  });

  it('opens in new tab using current doc formatting rules', async () => {
    const onOpenInDoc = vi.fn();
    const onOpenInNewTab = vi.fn();

    render(
      <>
        <span className="tipi-result-ncm" data-ncm="85171300">8517.13.00</span>
        <CrossNavContextMenu
          currentDoc="tipi"
          onOpenInDoc={onOpenInDoc}
          onOpenInNewTab={onOpenInNewTab}
        />
      </>,
    );

    fireEvent.contextMenu(screen.getByText('8517.13.00'), { clientX: 80, clientY: 80 });
    fireEvent.click(await screen.findByText('Abrir em nova aba'));

    expect(onOpenInNewTab).toHaveBeenCalledWith('tipi', '8517.13.00');
    expect(onOpenInDoc).not.toHaveBeenCalled();
  });

  it('closes menu on escape and outside click', async () => {
    render(
      <>
        <span className="ncm-target">85.17 - Telefone</span>
        <CrossNavContextMenu
          currentDoc="nesh"
          onOpenInDoc={vi.fn()}
          onOpenInNewTab={vi.fn()}
        />
      </>,
    );

    fireEvent.contextMenu(screen.getByText('85.17 - Telefone'), { clientX: 80, clientY: 80 });
    await screen.findByText('Ver na TIPI');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Ver na TIPI')).not.toBeInTheDocument());

    fireEvent.contextMenu(screen.getByText('85.17 - Telefone'), { clientX: 80, clientY: 80 });
    await screen.findByText('Ver na TIPI');
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByText('Ver na TIPI')).not.toBeInTheDocument());
  });

  it('ignores right-click events without compatible ncm target', () => {
    render(
      <>
        <div>texto sem código</div>
        <CrossNavContextMenu
          currentDoc="nesh"
          onOpenInDoc={vi.fn()}
          onOpenInNewTab={vi.fn()}
        />
      </>,
    );

    fireEvent.contextMenu(screen.getByText('texto sem código'), { clientX: 30, clientY: 30 });
    expect(screen.queryByText('Copiar NCM')).not.toBeInTheDocument();
  });
});
