import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type React from 'react';
import { TabsBar } from '../../src/components/TabsBar';
import styles from '../../src/components/TabsBar.module.css';
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

describe('TabsBar', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('scrolls active tab into view and marks active class', () => {
    render(
      <TabsBar
        tabs={tabs}
        activeTabId="tab-2"
        onSwitch={vi.fn()}
        onClose={vi.fn()}
        onNewTab={vi.fn()}
      />,
    );

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    const tabButtons = screen.getAllByText(/Aba/).map((node) => node.closest('div') as HTMLDivElement);
    expect(tabButtons[1].className).toContain(styles.tabButtonActive);
    expect(tabButtons[0].className).not.toContain(styles.tabButtonActive);
  });

  it('handles click and keyboard interactions to switch tabs', () => {
    const onSwitch = vi.fn();
    render(
      <TabsBar tabs={tabs} activeTabId="tab-1" onSwitch={onSwitch} onClose={vi.fn()} onNewTab={vi.fn()} />,
    );

    fireEvent.click(screen.getByText('Aba TIPI'));
    fireEvent.keyDown(screen.getByText('Aba NESH').closest('div') as HTMLDivElement, { key: 'Enter' });
    fireEvent.keyDown(screen.getByText('Aba NESH').closest('div') as HTMLDivElement, { key: ' ' });
    fireEvent.keyDown(screen.getByText('Aba NESH').closest('div') as HTMLDivElement, { key: 'Escape' });

    expect(onSwitch).toHaveBeenCalledWith('tab-2');
    expect(onSwitch).toHaveBeenCalledWith('tab-1');
    expect(onSwitch).toHaveBeenCalledTimes(3);
  });

  it('routes close and new tab actions through callbacks', () => {
    const onClose = vi.fn((event: React.MouseEvent) => event.stopPropagation());
    const onNewTab = vi.fn();
    render(<TabsBar tabs={tabs} activeTabId="tab-1" onSwitch={vi.fn()} onClose={onClose} onNewTab={onNewTab} />);

    const closeButtons = screen.getAllByTitle('Fechar aba');
    fireEvent.click(closeButtons[0]);
    fireEvent.click(screen.getByTitle('Nova aba'));

    expect(onClose).toHaveBeenCalledWith(expect.anything(), 'tab-1');
    expect(onNewTab).toHaveBeenCalledTimes(1);
  });

  it('renders document badges for nesh and tipi tabs', () => {
    render(
      <TabsBar tabs={tabs} activeTabId="tab-1" onSwitch={vi.fn()} onClose={vi.fn()} onNewTab={vi.fn()} />,
    );

    expect(screen.getByText('N')).toBeInTheDocument();
    expect(screen.getByText('T')).toBeInTheDocument();
    expect(screen.getAllByText('Aba NESH')[0].closest('[data-document="nesh"]')).toBeInTheDocument();
    expect(screen.getAllByText('Aba TIPI')[0].closest('[data-document="tipi"]')).toBeInTheDocument();
  });
});
