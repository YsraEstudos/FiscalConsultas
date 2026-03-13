import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GlossaryModal } from '../../src/components/GlossaryModal';

describe('GlossaryModal', () => {
  it('renders nothing while closed', () => {
    render(
      <GlossaryModal
        isOpen={false}
        onClose={vi.fn()}
        term="NCM"
        definition={null}
        loading={false}
      />,
    );

    expect(screen.queryByText(/Glossário:/i)).not.toBeInTheDocument();
  });

  it('shows a loading state while fetching a term definition', () => {
    render(
      <GlossaryModal
        isOpen={true}
        onClose={vi.fn()}
        term="drawback"
        definition={null}
        loading={true}
      />,
    );

    expect(screen.getByText('Glossário: drawback')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Buscando definição...');
  });

  it('renders the definition and footer when data is available', () => {
    render(
      <GlossaryModal
        isOpen={true}
        onClose={vi.fn()}
        term="NCM"
        definition="Nomenclatura Comum do Mercosul"
        loading={false}
      />,
    );

    expect(screen.getByText('Nomenclatura Comum do Mercosul')).toBeInTheDocument();
    expect(screen.getByText('Agri-Food & Customs Glossary')).toBeInTheDocument();
  });

  it('renders the not-found state when no definition is returned', () => {
    render(
      <GlossaryModal
        isOpen={true}
        onClose={vi.fn()}
        term="sem resultado"
        definition={null}
        loading={false}
      />,
    );

    expect(screen.getByText('Definição não encontrada para "sem resultado".')).toBeInTheDocument();
  });
});
