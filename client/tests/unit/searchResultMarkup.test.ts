import { describe, expect, it } from 'vitest';

import { buildLocalCodeSearchResponse, resolveSearchResponseMarkup } from '../../src/utils/searchResultMarkup';

type TipiPositionFixture = {
  codigo: string;
  ncm: string;
  descricao: string;
  aliquota: string | number;
  nivel: number;
};

type TipiChapterFixture = {
  capitulo: string;
  titulo: string;
  posicao_alvo: string;
  posicoes: TipiPositionFixture[];
};

type NeshChapterFixture = {
  capitulo: string;
  ncm_buscado: string;
  posicao_alvo: string;
  posicoes: unknown[];
  notas_gerais: null;
  notas_parseadas: Record<string, unknown>;
  conteudo: string;
  real_content_found: boolean;
  erro: null;
};

const defaultTipiPosition: TipiPositionFixture = {
  codigo: '2203.00.00',
  ncm: '22030000',
  descricao: 'Cervejas de malte',
  aliquota: '6.5',
  nivel: 1,
};

const defaultTipiChapter: Omit<TipiChapterFixture, 'posicoes'> = {
  capitulo: '22',
  titulo: 'Bebidas',
  posicao_alvo: '2203',
};

const defaultNeshChapter: NeshChapterFixture = {
  capitulo: '85',
  ncm_buscado: '8512',
  posicao_alvo: '8512',
  posicoes: [],
  notas_gerais: null,
  notas_parseadas: {},
  conteudo: '85.12 - Aparelhos eletricos de iluminacao',
  real_content_found: true,
  erro: null,
};

function makeTipiPosition(overrides: Partial<TipiPositionFixture> = {}): TipiPositionFixture {
  return { ...defaultTipiPosition, ...overrides };
}

function makeTipiChapter(
  overrides: Partial<Omit<TipiChapterFixture, 'posicoes'>> = {},
  posicoes: TipiPositionFixture[] = [makeTipiPosition()],
): TipiChapterFixture {
  return {
    ...defaultTipiChapter,
    ...overrides,
    posicoes,
  };
}

function makeTipiResponse(options: {
  query?: string;
  chapterKey?: string;
  chapterOverrides?: Partial<Omit<TipiChapterFixture, 'posicoes'>>;
  posicoes?: TipiPositionFixture[];
} = {}) {
  const {
    query = '2203',
    chapterKey = '22',
    chapterOverrides = {},
    posicoes = [makeTipiPosition()],
  } = options;

  return buildLocalCodeSearchResponse('tipi', query, {
    [chapterKey]: makeTipiChapter(chapterOverrides, posicoes),
  });
}

function makeNeshResponse(overrides: Partial<NeshChapterFixture> = {}) {
  return buildLocalCodeSearchResponse('nesh', '8512', {
    '85': {
      ...defaultNeshChapter,
      ...overrides,
    },
  });
}

describe('searchResultMarkup', () => {
  it('returns backend markdown for NESH code responses when available', () => {
    const markup = resolveSearchResponseMarkup('nesh', {
      success: true,
      type: 'code',
      query: '8512',
      normalized: null,
      results: {},
      total_capitulos: 0,
      markdown: '<h1>NESH 8512</h1>',
    });

    expect(markup).toBe('<h1>NESH 8512</h1>');
  });

  it('renders local NESH code results when chapter content exists', () => {
    const markup = resolveSearchResponseMarkup('nesh', makeNeshResponse());

    expect(markup).toContain('chapter-85');
    expect(markup).toContain('nesh-chapter-title');
    expect(markup).toContain('85.12');
  });

  it('renders TIPI code results without backend markdown', () => {
    const markup = resolveSearchResponseMarkup('tipi', makeTipiResponse());

    expect(markup).toContain('Bebidas');
    expect(markup).toContain('2203.00.00');
    expect(markup).toContain('6.5%');
  });

  it('returns null for TIPI code payloads without renderable chapters', () => {
    const markup = resolveSearchResponseMarkup(
      'tipi',
      makeTipiResponse({
        chapterKey: 'empty',
        chapterOverrides: { capitulo: '', titulo: '', posicao_alvo: '' },
        posicoes: [],
      }),
    );

    expect(markup).toBeNull();
  });

  it.each([
    {
      label: 'decimal zero',
      aliquota: '0,0',
      expectedClass: 'aliquot-zero',
      unexpectedClass: 'aliquot-low',
      expectedDisplay: '>0%</span>',
    },
    {
      label: 'invalid',
      aliquota: 'desconhecida',
      expectedClass: 'aliquot-unknown',
      unexpectedClass: 'aliquot-zero',
      expectedDisplay: '>N/I</span>',
    },
  ])('classifies $label aliquota correctly', ({ aliquota, expectedClass, unexpectedClass, expectedDisplay }) => {
    const markup = resolveSearchResponseMarkup(
      'tipi',
      makeTipiResponse({
        chapterOverrides: { capitulo: '22', titulo: 'Bebidas', posicao_alvo: '2203' },
        posicoes: [makeTipiPosition({ aliquota })],
      }),
    );

    expect(markup).toContain(expectedClass);
    expect(markup).not.toContain(unexpectedClass);
    expect(markup).toContain(expectedDisplay);
  });

  it('escapes dynamic values in TIPI fallback markup', () => {
    const markup = resolveSearchResponseMarkup(
      'tipi',
      makeTipiResponse({
        chapterOverrides: {
          capitulo: '22"><script>alert(1)</script>',
          titulo: 'Bebidas <script>alert(1)</script>',
          posicao_alvo: '2203',
        },
        posicoes: [
          makeTipiPosition({
            codigo: '2203.00.00"><img src=x onerror=alert(1)>',
            ncm: '22030000" onclick="alert(1)',
            descricao: 'Cervejas <b>fortes</b>',
            aliquota: '6.5"><script>alert(1)</script>',
            nivel: 99,
          }),
        ],
      }),
    );

    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(markup).toContain('Cervejas &lt;b&gt;fortes&lt;/b&gt;');
    expect(markup).not.toContain('<script>alert(1)</script>');
    expect(markup).not.toContain('<img src=x onerror=alert(1)>');
    expect(markup).toContain('tipi-nivel-5');
  });

  it('escapes dynamic values in text search fallback markup', () => {
    const markup = resolveSearchResponseMarkup('tipi', {
      success: true,
      type: 'text',
      query: 'vinho',
      results: [
        {
          ncm: '2204"><script>alert(1)</script>',
          descricao: 'Vinhos <em>espumantes</em>',
          aliquota: '10"><img src=x onerror=alert(1)>',
        },
      ],
    });

    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markup).toContain('Vinhos &lt;em&gt;espumantes&lt;/em&gt;');
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(markup).not.toContain('<script>alert(1)</script>');
    expect(markup).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('preserves zero aliquota in text search fallback markup', () => {
    const markup = resolveSearchResponseMarkup('tipi', {
      success: true,
      type: 'text',
      query: 'vinho',
      results: [
        {
          ncm: '2204',
          descricao: 'Vinhos',
          aliquota: 0,
        },
      ],
    });

    expect(markup).toContain('<strong>0</strong>');
  });

  it('returns null for invalid or non-renderable code payloads', () => {
    const markup = resolveSearchResponseMarkup('nesh', makeNeshResponse({ conteudo: '' }));

    expect(markup).toBeNull();
  });
});
