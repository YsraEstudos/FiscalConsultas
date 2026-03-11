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

const createRect = (left: number, width: number): DOMRect =>
  ({
    x: left,
    y: 0,
    top: 0,
    left,
    right: left + width,
    bottom: 32,
    width,
    height: 32,
    toJSON: () => ({}),
  } as DOMRect);

describe('TabsBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('marks the active tab class without using element scrollIntoView', () => {
    render(
      <TabsBar
        tabs={tabs}
        activeTabId="tab-2"
        onSwitch={vi.fn()}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onNewTab={vi.fn()}
      />,
    );

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    const tabButtons = screen.getAllByText(/Aba/).map((node) => node.closest('div') as HTMLDivElement);
    expect(tabButtons[1].className).toContain(styles.tabButtonActive);
    expect(tabButtons[0].className).not.toContain(styles.tabButtonActive);
  });

  it('keeps the active tab visible by scrolling the tab strip horizontally', () => {
    const onSwitch = vi.fn();
    const onClose = vi.fn();
    const onReorder = vi.fn();
    const onNewTab = vi.fn();

    const { container, rerender } = render(
      <TabsBar
        tabs={tabs}
        activeTabId="tab-1"
        onSwitch={onSwitch}
        onClose={onClose}
        onReorder={onReorder}
        onNewTab={onNewTab}
      />,
    );

    const tabsContainer = container.querySelector(`.${styles.tabsContainer}`) as HTMLDivElement | null;
    const activeTab = screen.getByText('Aba TIPI').closest('div') as HTMLDivElement | null;

    expect(tabsContainer).not.toBeNull();
    expect(activeTab).not.toBeNull();
    if (!tabsContainer || !activeTab) return;

    Object.defineProperty(tabsContainer, 'scrollLeft', {
      configurable: true,
      writable: true,
      value: 0,
    });
    Object.defineProperty(tabsContainer, 'scrollWidth', {
      configurable: true,
      value: 480,
    });
    Object.defineProperty(tabsContainer, 'clientWidth', {
      configurable: true,
      value: 200,
    });

    vi.spyOn(tabsContainer, 'getBoundingClientRect').mockReturnValue(createRect(0, 200));
    vi.spyOn(activeTab, 'getBoundingClientRect').mockReturnValue(createRect(260, 80));

    const scrollToSpy = vi.spyOn(tabsContainer, 'scrollTo');
    scrollToSpy.mockClear();

    rerender(
      <TabsBar
        tabs={tabs}
        activeTabId="tab-2"
        onSwitch={onSwitch}
        onClose={onClose}
        onReorder={onReorder}
        onNewTab={onNewTab}
      />,
    );

    expect(scrollToSpy).toHaveBeenCalledWith({ left: 156, behavior: 'smooth' });
    expect(tabsContainer.scrollLeft).toBe(156);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('falls back to scrollLeft assignment when scrollTo is not available', () => {
    const onSwitch = vi.fn();
    const onClose = vi.fn();
    const onReorder = vi.fn();
    const onNewTab = vi.fn();

    const { container, rerender } = render(
      <TabsBar
        tabs={tabs}
        activeTabId="tab-1"
        onSwitch={onSwitch}
        onClose={onClose}
        onReorder={onReorder}
        onNewTab={onNewTab}
      />,
    );

    const tabsContainer = container.querySelector(`.${styles.tabsContainer}`) as HTMLDivElement | null;
    const activeTab = screen.getByText('Aba TIPI').closest('div') as HTMLDivElement | null;

    expect(tabsContainer).not.toBeNull();
    expect(activeTab).not.toBeNull();
    if (!tabsContainer || !activeTab) return;

    Object.defineProperty(tabsContainer, 'scrollLeft', {
      configurable: true,
      writable: true,
      value: 0,
    });
    Object.defineProperty(tabsContainer, 'scrollWidth', {
      configurable: true,
      value: 480,
    });
    Object.defineProperty(tabsContainer, 'clientWidth', {
      configurable: true,
      value: 200,
    });

    vi.spyOn(tabsContainer, 'getBoundingClientRect').mockReturnValue(createRect(0, 200));
    vi.spyOn(activeTab, 'getBoundingClientRect').mockReturnValue(createRect(260, 80));

    // Remove scrollTo to exercise the fallback branch
    const originalScrollTo = Element.prototype.scrollTo;
    // @ts-ignore — intentionally removing scrollTo
    delete Element.prototype.scrollTo;

    try {
      rerender(
        <TabsBar
          tabs={tabs}
          activeTabId="tab-2"
          onSwitch={onSwitch}
          onClose={onClose}
          onReorder={onReorder}
          onNewTab={onNewTab}
        />,
      );

      // The fallback should have assigned scrollLeft directly
      expect(tabsContainer.scrollLeft).toBe(156);
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollTo = originalScrollTo;
    }
  });

  it('handles click and keyboard interactions to switch tabs', () => {
    const onSwitch = vi.fn();
    render(
      <TabsBar
        tabs={tabs}
        activeTabId="tab-1"
        onSwitch={onSwitch}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onNewTab={vi.fn()}
      />,
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
    render(
      <TabsBar
        tabs={tabs}
        activeTabId="tab-1"
        onSwitch={vi.fn()}
        onClose={onClose}
        onReorder={vi.fn()}
        onNewTab={onNewTab}
      />,
    );

    const closeButtons = screen.getAllByTitle('Fechar aba');
    fireEvent.click(closeButtons[0]);
    fireEvent.click(screen.getByTitle('Nova aba'));

    expect(onClose).toHaveBeenCalledWith(expect.anything(), 'tab-1');
    expect(onNewTab).toHaveBeenCalledTimes(1);
  });

  it('closes the tab on middle click without switching and prevents the default action', () => {
    const onClose = vi.fn((event: React.MouseEvent) => event.stopPropagation());
    const onSwitch = vi.fn();
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

    const tabButton = screen.getByText('Aba TIPI').closest('div') as HTMLDivElement | null;
    expect(tabButton).not.toBeNull();
    if (!tabButton) return;

    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 1,
    });

    tabButton.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledWith(expect.anything(), 'tab-2');
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('renders document badges for nesh and tipi tabs', () => {
    render(
      <TabsBar
        tabs={tabs}
        activeTabId="tab-1"
        onSwitch={vi.fn()}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onNewTab={vi.fn()}
      />,
    );

    expect(screen.getByText('N')).toBeInTheDocument();
    expect(screen.getByText('T')).toBeInTheDocument();
    expect(screen.getAllByText('Aba NESH')[0].closest('[data-document="nesh"]')).toBeInTheDocument();
    expect(screen.getAllByText('Aba TIPI')[0].closest('[data-document="tipi"]')).toBeInTheDocument();
  });
});
