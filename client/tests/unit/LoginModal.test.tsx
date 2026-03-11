import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LoginModal } from '../../src/components/LoginModal';

vi.mock('@clerk/react', () => ({
  SignIn: () => <div data-testid="clerk-sign-in">Clerk SignIn</div>,
}));

describe('LoginModal', () => {
  it('renders nothing while closed', () => {
    render(<LoginModal isOpen={false} onClose={vi.fn()} />);

    expect(screen.queryByText('Entrar')).not.toBeInTheDocument();
  });

  it('renders the embedded Clerk sign-in form when open', () => {
    render(<LoginModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Entrar')).toBeInTheDocument();
    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument();
  });

  it('closes on escape, close button, and overlay clicks', () => {
    const onClose = vi.fn();
    const { container } = render(<LoginModal isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '×' }));

    const overlay = container.firstElementChild as HTMLElement | null;
    expect(overlay).not.toBeNull();
    if (!overlay) return;

    fireEvent.mouseDown(overlay, { target: overlay, currentTarget: overlay });

    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
