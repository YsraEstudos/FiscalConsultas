import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TabsBar } from '../../src/components/TabsBar';
import type { Tab } from '../../src/hooks/useTabs';

const tabs: Tab[] = [
  {
    id: 'tab-1',
    title: 'Aba NESH',
    document: 'nesh',
    content: null,
    loading: false,
    error: null,
  },
  {
    id: 'tab-2',
    title: 'Aba TIPI',
    document: 'tipi',
    content: null,
    loading: false,
    error: null,
  },
];

const originalScrollIntoView = Element.prototype.scrollIntoView;

function findTabContainer(label: string) {
  return screen.getByText(label).closest('[data-document]') as HTMLDivElement;
}

function createDataTransfer(initialText = '') {
  let text = initialText;
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn((_type: string, value: string) => {
      text = value;
    }),
    getData: vi.fn(() => text),
  };
}

describe('TabsBar behavior', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('configures drag metadata and reorders tabs on drop', () => {
    const onReorder = vi.fn();
    const dataTransfer = createDataTransfer();

    render(
      <TabsBar
        tabs={tabs}
        activeTabId="tab-1"
        onSwitch={vi.fn()}
        onClose={vi.fn()}
        onReorder={onReorder}
        onNewTab={vi.fn()}
      />,
    );

    const draggedTab = findTabContainer('Aba NESH');
    const targetTab = findTabContainer('Aba TIPI');

    fireEvent.dragStart(draggedTab, { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe('move');
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'tab-1');

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragOverEvent, 'dataTransfer', { value: dataTransfer });
    targetTab.dispatchEvent(dragOverEvent);
    expect(dragOverEvent.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe('move');

    fireEvent.drop(targetTab, { dataTransfer });
    expect(onReorder).toHaveBeenCalledWith('tab-1', 'tab-2');
  });

  it('falls back to the dataTransfer payload when the dragged ref is missing and ignores empty drops after drag end', () => {
    const onReorder = vi.fn();

    render(
      <TabsBar
        tabs={tabs}
        activeTabId="tab-1"
        onSwitch={vi.fn()}
        onClose={vi.fn()}
        onReorder={onReorder}
        onNewTab={vi.fn()}
      />,
    );

    const draggedTab = findTabContainer('Aba NESH');
    const targetTab = findTabContainer('Aba TIPI');

    fireEvent.dragStart(draggedTab, { dataTransfer: createDataTransfer() });
    fireEvent.dragEnd(draggedTab);

    const fallbackDataTransfer = createDataTransfer('tab-1');
    fireEvent.drop(targetTab, { dataTransfer: fallbackDataTransfer });
    expect(onReorder).toHaveBeenCalledWith('tab-1', 'tab-2');

    onReorder.mockClear();
    fireEvent.drop(targetTab, { dataTransfer: createDataTransfer('') });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('switches on Enter and Space, ignores other keys, and keeps close clicks from switching when propagation is stopped', () => {
    const onSwitch = vi.fn();
    const onClose = vi.fn((event: React.MouseEvent) => event.stopPropagation());

    render(
      <TabsBar
        tabs={tabs}
        activeTabId="tab-1"
        onSwitch={onSwitch}
        onClose={onClose}
        onReorder={vi.fn()}
        onNewTab={vi.fn()}
      />,
    );

    const neshTab = findTabContainer('Aba NESH');

    fireEvent.keyDown(neshTab, { key: 'Escape' });
    fireEvent.keyDown(neshTab, { key: 'Enter' });
    fireEvent.keyDown(neshTab, { key: ' ' });

    expect(onSwitch).toHaveBeenNthCalledWith(1, 'tab-1');
    expect(onSwitch).toHaveBeenNthCalledWith(2, 'tab-1');
    expect(onSwitch).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getAllByTitle('Fechar aba')[0]);
    expect(onClose).toHaveBeenCalledWith(expect.anything(), 'tab-1');
    expect(onSwitch).toHaveBeenCalledTimes(2);
  });
});
