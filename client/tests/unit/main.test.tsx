import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refs = vi.hoisted(() => ({
  capturedNode: { current: null as React.ReactNode },
  renderMock: vi.fn<(node: React.ReactNode) => void>(),
  createRootMock: vi.fn(),
}));

vi.mock('react-dom/client', () => ({
  createRoot: refs.createRootMock,
}));

vi.mock('../../src/App', () => ({
  default: () => <div data-testid="app">App</div>,
}));

vi.mock('@clerk/react', () => ({
  ClerkProvider: ({
    children,
    publishableKey,
  }: {
    children: React.ReactNode;
    publishableKey: string;
  }) => (
    <div data-testid="clerk-provider" data-publishable-key={publishableKey}>
      {children}
    </div>
  ),
}));

vi.mock('../../src/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-provider">{children}</div>
  ),
}));

vi.mock('../../src/context/SettingsContext', () => ({
  SettingsProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="settings-provider">{children}</div>
  ),
}));

vi.mock('../../src/context/GlossaryContext', () => ({
  GlossaryProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="glossary-provider">{children}</div>
  ),
}));

vi.mock('../../src/context/CrossChapterNoteContext', () => ({
  CrossChapterNoteProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="cross-note-provider">{children}</div>
  ),
}));

vi.mock('../../src/config/clerkAppearance', () => ({
  clerkTheme: { variables: {} },
}));

async function loadMainModule() {
  vi.resetModules();
  refs.capturedNode.current = null;
  refs.renderMock.mockReset();
  refs.createRootMock.mockReset();
  refs.renderMock.mockImplementation((node: React.ReactNode) => {
    refs.capturedNode.current = node;
  });
  refs.createRootMock.mockReturnValue({
    render: refs.renderMock,
  });
  return import('../../src/main');
}

describe('main.tsx bootstrap', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.unstubAllEnvs();
  });

  it('throws when the root element is missing', async () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_123');

    await expect(loadMainModule()).rejects.toThrow('Failed to find the root element');
  });

  it('renders the full provider tree when the Clerk key is configured', async () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_123');
    document.body.innerHTML = '<div id="root"></div>';

    await loadMainModule();

    expect(refs.createRootMock).toHaveBeenCalledWith(document.getElementById('root'));
    expect(refs.renderMock).toHaveBeenCalledTimes(1);
    expect(refs.capturedNode.current).not.toBeNull();

    render(<>{refs.capturedNode.current}</>);

    expect(screen.getByTestId('clerk-provider')).toHaveAttribute('data-publishable-key', 'pk_test_123');
    expect(screen.getByTestId('auth-provider')).toBeInTheDocument();
    expect(screen.getByTestId('settings-provider')).toBeInTheDocument();
    expect(screen.getByTestId('glossary-provider')).toBeInTheDocument();
    expect(screen.getByTestId('cross-note-provider')).toBeInTheDocument();
    expect(screen.getByTestId('app')).toBeInTheDocument();
  });

  it('renders the configuration fallback and logs an error when the Clerk key is missing', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await loadMainModule();

      expect(refs.createRootMock).toHaveBeenCalledWith(document.getElementById('root'));
      render(<>{refs.capturedNode.current}</>);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Missing Clerk key. Configure VITE_CLERK_PUBLISHABLE_KEY in client/.env.local and restart Vite.',
      );
      expect(screen.getByText('Configuration Required')).toBeInTheDocument();
      expect(screen.getAllByText(/VITE_CLERK_PUBLISHABLE_KEY/)).toHaveLength(2);
      expect(screen.getByText(/npm run dev/)).toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
