import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServicesTabContent } from '../../src/components/ServicesTabContent';

const hoisted = vi.hoisted(() => ({
  getNbsServiceDetailPageMock: vi.fn(),
  getNbsServiceTreePageMock: vi.fn(),
  getNbsDetailLocalMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../../src/services/api', () => ({
  getNbsServiceDetailPage: hoisted.getNbsServiceDetailPageMock,
  getNbsServiceTreePage: hoisted.getNbsServiceTreePageMock,
}));

vi.mock('../../src/context/LocalDatabaseContext', () => ({
  useLocalDatabase: () => ({
    status: 'ready',
    getNbsDetailLocal: hoisted.getNbsDetailLocalMock,
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: hoisted.toastErrorMock,
  },
}));

vi.mock('../../src/components/ServicesWorkspace', () => ({
  ServicesWorkspace: ({ nbsState }: any) => (
    <div data-testid="services-workspace">
      <div data-testid="selected-code">{nbsState.selectedCode ?? ''}</div>
      <div data-testid="chapter-count">{nbsState.detail?.chapter_items?.length ?? 0}</div>
      <div data-testid="chapter-codes">
        {(nbsState.detail?.chapter_items ?? []).map((item: any) => item.code).join(',')}
      </div>
    </div>
  ),
}));

const baseItem = {
  code: '1.06',
  code_clean: '106',
  description: 'Serviços de apoio aos transportes',
  parent_code: '1',
  level: 2,
  has_nebs: true,
};

describe('ServicesTabContent', () => {
  beforeEach(() => {
    hoisted.getNbsServiceDetailPageMock.mockReset();
    hoisted.getNbsServiceTreePageMock.mockReset();
    hoisted.getNbsDetailLocalMock.mockReset();
    hoisted.toastErrorMock.mockReset();
  });

  it('accumulates paginated NBS chapter items from the local database only', async () => {
    hoisted.getNbsDetailLocalMock
      .mockResolvedValueOnce({
        success: true,
        item: baseItem,
        ancestors: [],
        children: [],
        chapter_root: baseItem,
        chapter_items: [
          {
            code: '1.0605',
            code_clean: '10605',
            description: 'Serviços de apoio ao transporte aquaviário',
            parent_code: '1.06',
            level: 3,
            has_nebs: false,
          },
        ],
        chapter_page: {
          items: [
            {
              code: '1.0605',
              code_clean: '10605',
              description: 'Serviços de apoio ao transporte aquaviário',
              parent_code: '1.06',
              level: 3,
              has_nebs: false,
            },
          ],
          page: 1,
          page_size: 1,
          total: 3,
          has_more: true,
        },
        nebs: null,
      })
      .mockResolvedValueOnce({
        success: true,
        item: baseItem,
        ancestors: [],
        children: [],
        chapter_root: baseItem,
        chapter_items: [],
        chapter_page: {
          items: [
            {
              code: '1.0608',
              code_clean: '10608',
              description: 'Serviços de apoio ao transporte multimodal de cargas',
              parent_code: '1.06',
              level: 3,
              has_nebs: false,
            },
            {
              code: '1.0609.00.00',
              code_clean: '106090000',
              description: 'Serviços de apoio aos transportes não classificados em posições anteriores',
              parent_code: '1.06',
              level: 3,
              has_nebs: false,
            },
          ],
          page: 2,
          page_size: 1,
          total: 3,
          has_more: false,
        },
        nebs: null,
      });

    render(
      <ServicesTabContent
        doc="nbs"
        data={{
          success: true,
          query: '1.06',
          normalized: '106',
          total: 1,
          results: [baseItem],
        }}
        onSwitchDoc={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('chapter-count')).toHaveTextContent('3');
    });

    expect(hoisted.getNbsDetailLocalMock).toHaveBeenNthCalledWith(1, '1.06', {
      page: 1,
      pageSize: 50,
    });
    expect(hoisted.getNbsDetailLocalMock).toHaveBeenNthCalledWith(2, '1.06', {
      page: 2,
      pageSize: 1,
    });
    expect(hoisted.getNbsServiceDetailPageMock).not.toHaveBeenCalled();
    expect(hoisted.getNbsServiceTreePageMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('chapter-codes')).toHaveTextContent(
      '1.0605,1.0608,1.0609.00.00',
    );
    expect(hoisted.toastErrorMock).not.toHaveBeenCalled();
  });
});
