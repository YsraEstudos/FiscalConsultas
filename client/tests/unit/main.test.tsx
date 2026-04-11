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
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('throws when the root element is missing', async () => {
    await expect(loadMainModule()).rejects.toThrow('Failed to find the root element');
  });

  it('renders the full provider tree when the root is available', async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await loadMainModule();

    expect(refs.createRootMock).toHaveBeenCalledWith(document.getElementById('root'));
    expect(refs.renderMock).toHaveBeenCalledTimes(1);
    expect(refs.capturedNode.current).not.toBeNull();

    render(<>{refs.capturedNode.current}</>);

    expect(screen.getByTestId('auth-provider')).toBeInTheDocument();
    expect(screen.getByTestId('settings-provider')).toBeInTheDocument();
    expect(screen.getByTestId('glossary-provider')).toBeInTheDocument();
    expect(screen.getByTestId('cross-note-provider')).toBeInTheDocument();
    expect(screen.getByTestId('app')).toBeInTheDocument();
  });

  it('still renders the app tree even when the Clerk key is missing', async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await loadMainModule();

    expect(refs.createRootMock).toHaveBeenCalledWith(document.getElementById('root'));
    render(<>{refs.capturedNode.current}</>);

    expect(screen.getByTestId('auth-provider')).toBeInTheDocument();
    expect(screen.getByTestId('app')).toBeInTheDocument();
  });
});
