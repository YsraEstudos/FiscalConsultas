import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Loading } from '../../src/components/Loading';
import styles from '../../src/components/Loading.module.css';

describe('Loading', () => {
  it('renders the default accessible loading state', () => {
    render(<Loading />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Carregando...');
    expect(status.querySelector(`.${styles.spinner}`)).toBeInTheDocument();
  });

  it('supports custom labels, sizes, and wrapper classes', () => {
    render(<Loading label="Buscando dados" size="sm" className="custom-class" />);

    const status = screen.getByRole('status');
    expect(status).toHaveClass('custom-class');
    expect(status).toHaveTextContent('Buscando dados');
    expect(status.querySelector(`.${styles.spinnerSm}`)).toBeInTheDocument();
  });

  it('omits the label node when label is empty', () => {
    render(<Loading label="" />);

    expect(screen.getByRole('status')).not.toHaveTextContent('Carregando...');
    expect(screen.queryByText('Carregando...')).not.toBeInTheDocument();
  });
});
