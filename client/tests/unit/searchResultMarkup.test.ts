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
