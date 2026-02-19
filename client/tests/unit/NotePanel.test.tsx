import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NotePanel } from '../../src/components/NotePanel';
import styles from '../../src/components/NotePanel.module.css';

describe('NotePanel', () => {
  it('does not render when closed', () => {
    const { container } = render(
      <NotePanel
        isOpen={false}
        onClose={vi.fn()}
        note="1"
        chapter="84"
        content="Conteudo"
        position="right"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders note content and closes from button click', () => {
    const onClose = vi.fn();

    render(
      <NotePanel
        isOpen
        onClose={onClose}
        note="2"
        chapter="73"
        content="Linha 1\nLinha 2"
        position="right"
      />,
    );

    const panel = screen.getByLabelText('Nota 2 do Capítulo 73');
    expect(panel).toBeInTheDocument();
    expect(panel.className).toContain(styles.panel);
    expect(panel.className).toContain(styles.right);
    expect(panel.className).toContain(styles.open);

    expect(screen.getByText('Nota 2')).toBeInTheDocument();
    expect(screen.getByText('Capítulo 73')).toBeInTheDocument();
    expect(screen.getByText(/Linha 1/).textContent).toContain('Linha 2');

    fireEvent.click(screen.getByRole('button', { name: /fechar nota/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies left-side class when configured', () => {
    render(
      <NotePanel
        isOpen
        onClose={vi.fn()}
        note="9"
        chapter="99"
        content="Texto"
        position="left"
      />,
    );

    const panel = screen.getByLabelText('Nota 9 do Capítulo 99');
    expect(panel.className).toContain(styles.left);
  });
});
