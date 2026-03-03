import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
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
  let queuedFrames: Array<{ id: number; callback: FrameRequestCallback }>;
  let heights: Record<string, number>;
  let nextFrameId: number;

  const flushAnimationFrames = () => {
    while (queuedFrames.length > 0) {
      const nextFrame = queuedFrames.shift();
      nextFrame?.callback(0);
    }
  };

  beforeEach(() => {
    queuedFrames = [];
    nextFrameId = 1;
    heights = {
      c1: 130,
      c2: 120,
      __pending__: 130,
    };

    requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      queuedFrames.push({ id, callback: cb });
      return id;
    });
    cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      queuedFrames = queuedFrames.filter(frame => frame.id !== id);
    });

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

    act(() => {
      flushAnimationFrames();
    });

    let firstCard = container.querySelector('[data-comment-card-id="c1"]') as HTMLElement | null;
    let secondCard = container.querySelector('[data-comment-card-id="c2"]') as HTMLElement | null;
    expect(firstCard).not.toBeNull();
    expect(secondCard).not.toBeNull();
    if (!firstCard || !secondCard) return;

    expect(firstCard.style.top).toBe('0px');
    expect(secondCard.style.top).toBe('300px');

    heights.c1 = 280;
    act(() => {
      fireEvent.click(within(firstCard).getByLabelText('Editar comentário'));
      flushAnimationFrames();
    });

    await waitFor(() => {
      act(() => {
        flushAnimationFrames();
      });
      firstCard = container.querySelector('[data-comment-card-id="c1"]') as HTMLElement | null;
      secondCard = container.querySelector('[data-comment-card-id="c2"]') as HTMLElement | null;
      expect(firstCard).not.toBeNull();
      expect(secondCard).not.toBeNull();
      expect(firstCard?.style.top).toBe('0px');
      expect(secondCard?.style.top).toBe('340px');
    });
  });
});
