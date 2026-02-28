import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommentPanel, type LocalComment } from '../../src/components/CommentPanel';

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
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn>;
  let queuedFrames: FrameRequestCallback[];
  let heights: Record<string, number>;

  const flushAnimationFrames = () => {
    while (queuedFrames.length > 0) {
      const callback = queuedFrames.shift();
      callback?.(0);
    }
  };

  beforeEach(() => {
    queuedFrames = [];
    heights = {
      c1: 130,
      c2: 120,
      __pending__: 130,
    };

    requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      queuedFrames.push(cb);
      return queuedFrames.length;
    });
    cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        const id = this.getAttribute?.('data-comment-card-id');
        return id ? (heights[id] ?? 0) : 0;
      },
    });
  });

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();

    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).offsetHeight;
    }
  });

  it('remeasures dependent card positions when layout-affecting state changes', async () => {
    const comments = [
      makeComment('c1', 0, 'Primeiro comentario'),
      makeComment('c2', 300, 'Segundo comentario'),
    ];

    const { container } = render(
      <CommentPanel
        pending={null}
        comments={comments}
        onSubmit={async () => true}
        onDismiss={() => {}}
        onEdit={async () => {}}
        onDelete={async () => {}}
        currentUserId="user_test"
      />,
    );

    flushAnimationFrames();

    let firstCard = container.querySelector('[data-comment-card-id="c1"]') as HTMLElement | null;
    let secondCard = container.querySelector('[data-comment-card-id="c2"]') as HTMLElement | null;
    expect(firstCard).not.toBeNull();
    expect(secondCard).not.toBeNull();
    if (!firstCard || !secondCard) return;

    expect(firstCard.style.top).toBe('0px');
    expect(secondCard.style.top).toBe('300px');

    heights.c1 = 280;
    fireEvent.click(container.querySelector('[data-comment-card-id="c1"] [aria-label="Editar comentário"]') as HTMLElement);
    flushAnimationFrames();

    await waitFor(() => {
      firstCard = container.querySelector('[data-comment-card-id="c1"]') as HTMLElement | null;
      secondCard = container.querySelector('[data-comment-card-id="c2"]') as HTMLElement | null;
      expect(firstCard).not.toBeNull();
      expect(secondCard).not.toBeNull();
      expect(firstCard?.style.top).toBe('0px');
      expect(secondCard?.style.top).toBe('340px');
    });
  });
});
