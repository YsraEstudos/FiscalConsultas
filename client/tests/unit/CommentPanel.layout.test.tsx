import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommentPanel, type LocalComment } from '../../src/components/CommentPanel';

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];

  private callback: ResizeObserverCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }

  emitHeight(target: Element, height: number) {
    const entry = {
      target,
      contentRect: { height },
    } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

function makeComment(id: string, anchorTop: number, body: string): LocalComment {
  return {
    id,
    anchorTop,
    anchorKey: `pos-${id}`,
    selectedText: 'trecho selecionado',
    body,
    isPrivate: false,
    createdAt: new Date('2026-02-26T12:00:00Z'),
    userName: 'Test User',
    userImageUrl: null,
    userId: 'user_test',
  };
}

describe('CommentPanel layout behavior', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    TestResizeObserver.instances = [];
    // @ts-expect-error - test-only override
    globalThis.ResizeObserver = TestResizeObserver;
  });

  afterEach(() => {
    // @ts-expect-error - restore original constructor
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('renders cards anchored to expected initial positions', () => {
    const comments = [
      makeComment('c1', 0, 'Primeiro comentário'),
      makeComment('c2', 300, 'Segundo comentário'),
    ];

    render(
      <CommentPanel
        pending={null}
        comments={comments}
        onSubmit={async () => true}
        onDismiss={() => {}}
      />,
    );

    const findCard = (text: string): HTMLElement | null => {
      return screen.getByText(text).closest<HTMLElement>('div[class*="commentCard"]');
    };

    const firstCard = findCard('Primeiro comentário');
    const secondCard = findCard('Segundo comentário');
    expect(firstCard).not.toBeNull();
    expect(secondCard).not.toBeNull();
    if (!firstCard || !secondCard) return;

    // Initial layout uses estimated height -> second card keeps anchor top.
    expect(firstCard.style.top).toBe('0px');
    expect(secondCard.style.top).toBe('300px');
  });
});
