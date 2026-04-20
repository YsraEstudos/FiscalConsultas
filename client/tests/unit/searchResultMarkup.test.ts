import { describe, expect, it } from 'vitest';

import { buildLocalCodeSearchResponse, resolveSearchResponseMarkup } from '../../src/utils/searchResultMarkup';

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
    const response = buildLocalCodeSearchResponse('nesh', '8512', {
      '85': {
        capitulo: '85',
        ncm_buscado: '8512',
        posicao_alvo: '8512',
        posicoes: [],
        notas_gerais: null,
        notas_parseadas: {},
        conteudo: '85.12 - Aparelhos elétricos de iluminação',
        real_content_found: true,
        erro: null,
      },
    });

    const markup = resolveSearchResponseMarkup('nesh', response);

    expect(markup).toContain('Capítulo 85');
    expect(markup).toContain('85.12');
  });

  it('renders TIPI code results without backend markdown', () => {
    const response = buildLocalCodeSearchResponse('tipi', '2203', {
      '22': {
        capitulo: '22',
        titulo: 'Bebidas',
        posicao_alvo: '2203',
        posicoes: [
          {
            codigo: '2203.00.00',
            ncm: '22030000',
            descricao: 'Cervejas de malte',
            aliquota: '6.5',
            nivel: 1,
          },
        ],
      },
    });

    const markup = resolveSearchResponseMarkup('tipi', response);

    expect(markup).toContain('Bebidas');
    expect(markup).toContain('2203.00.00');
    expect(markup).toContain('6.5%');
  });

  it('returns null for TIPI code payloads without renderable chapters', () => {
    const response = buildLocalCodeSearchResponse('tipi', '2203', {
      empty: {
        capitulo: '',
        titulo: '',
        posicoes: [],
      },
    });

    const markup = resolveSearchResponseMarkup('tipi', response);

    expect(markup).toBeNull();
  });

  it('classifies decimal zero aliquota as exempt instead of reduced', () => {
    const response = buildLocalCodeSearchResponse('tipi', '2203', {
      '22': {
        capitulo: '22',
        titulo: 'Bebidas',
        posicao_alvo: '2203',
        posicoes: [
          {
            codigo: '2203.00.00',
            ncm: '22030000',
            descricao: 'Cervejas de malte',
            aliquota: '0,0',
            nivel: 1,
          },
        ],
      },
    });

    const markup = resolveSearchResponseMarkup('tipi', response);

    expect(markup).toContain('aliquot-zero');
    expect(markup).not.toContain('aliquot-low');
    expect(markup).toContain('>0%</span>');
  });

  it('classifies missing or invalid aliquota as unknown', () => {
    const response = buildLocalCodeSearchResponse('tipi', '2203', {
      '22': {
        capitulo: '22',
        titulo: 'Bebidas',
        posicao_alvo: '2203',
        posicoes: [
          {
            codigo: '2203.00.00',
            ncm: '22030000',
            descricao: 'Cervejas de malte',
            aliquota: 'desconhecida',
            nivel: 1,
          },
        ],
      },
    });

    const markup = resolveSearchResponseMarkup('tipi', response);

    expect(markup).toContain('aliquot-unknown');
    expect(markup).toContain('>N/I</span>');
  });

  it('escapes dynamic values in TIPI fallback markup', () => {
    const response = buildLocalCodeSearchResponse('tipi', '2203', {
      '22': {
        capitulo: '22"><script>alert(1)</script>',
        titulo: 'Bebidas <script>alert(1)</script>',
        posicao_alvo: '2203',
        posicoes: [
          {
            codigo: '2203.00.00"><img src=x onerror=alert(1)>',
            ncm: '22030000" onclick="alert(1)',
            descricao: 'Cervejas <b>fortes</b>',
            aliquota: '6.5"><script>alert(1)</script>',
            nivel: 99,
          },
        ],
      },
    });

    const markup = resolveSearchResponseMarkup('tipi', response);

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
    const markup = resolveSearchResponseMarkup('nesh', {
      success: true,
      type: 'code',
      query: '85',
      normalized: null,
      results: {
        '85': {
          capitulo: '85',
          conteudo: '',
        },
      },
      total_capitulos: 1,
    });

    expect(markup).toBeNull();
  });
});
