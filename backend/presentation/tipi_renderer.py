"""
Renderer para dados da TIPI.
Gera HTML com destaque de alíquotas por cor.
"""

from typing import Dict, Any, List
from ..config.logging_config import renderer_logger as logger
from ..utils.id_utils import generate_anchor_id
from .renderer import HtmlRenderer

class TipiRenderer:
    """
    Renderiza dados da TIPI em HTML/Markdown.
    
    Features:
    - Destaque de alíquotas por cor (verde=0%, cinza=NT, laranja=>10%)
    - Links inteligentes para NCMs
    - Estrutura hierárquica por níveis
    """
    
    # Cores para alíquotas
    ALIQUOT_COLORS = {
        '0': 'aliquot-zero',      # Verde - Isento
        'NT': 'aliquot-nt',       # Cinza - Não Tributável
        'low': 'aliquot-low',     # Azul - 1-5%
        'medium': 'aliquot-med',  # Amarelo - 6-10%
        'high': 'aliquot-high',   # Laranja/Vermelho - >10%
    }
    
    @classmethod
    def get_aliquot_class(cls, aliquota: str) -> str:
        """Determina a classe CSS baseada na alíquota."""
        if not aliquota or aliquota == '':
            return cls.ALIQUOT_COLORS['0']
        
        aliq = aliquota.strip().upper()
        
        if aliq == '0' or aliq == '0%':
            return cls.ALIQUOT_COLORS['0']
        elif aliq == 'NT':
            return cls.ALIQUOT_COLORS['NT']
        else:
            try:
                # Extrair número
                num = float(aliq.replace('%', '').replace(',', '.'))
                if num <= 5:
                    return cls.ALIQUOT_COLORS['low']
                elif num <= 10:
                    return cls.ALIQUOT_COLORS['medium']
                else:
                    return cls.ALIQUOT_COLORS['high']
            except ValueError:
                return cls.ALIQUOT_COLORS['0']
    # Tooltip labels for aliquota types
    ALIQUOT_TOOLTIPS = {
        '0': 'Isento de IPI',
        'NT': 'Não Tributável',
        'low': 'Alíquota Reduzida (1-5%)',
        'medium': 'Alíquota Média (6-10%)',
        'high': 'Alíquota Elevada (>10%)',
    }
    
    @classmethod
    def render_position(cls, pos: Dict[str, Any]) -> str:
        """
        Renderiza uma posição NCM com estrutura semântica e acessibilidade.
        
        Melhorias:
        - aria-label para acessibilidade
        - data-tooltip para dicas visuais
        - Estrutura consistente com NESH
        """
        codigo = pos.get('codigo') or pos.get('ncm', '')
        ncm = pos.get('ncm') or codigo
        descricao = pos.get('descricao', '')
        descricao = HtmlRenderer.inject_exclusion_highlights(descricao)
        descricao = HtmlRenderer.inject_unit_highlights(descricao)
        aliquota = pos.get('aliquota', '0')
        nivel = pos.get('nivel', 1)
        
        # Classe de alíquota
        aliq_class = cls.get_aliquot_class(aliquota)
        
        # Tooltip para alíquota
        aliq_key = aliq_class.replace('aliquot-', '')
        tooltip = cls.ALIQUOT_TOOLTIPS.get(aliq_key, '')
        
        # Indentação baseada no nível (0-5, onde 5 = exceções)
        indent_class = f'tipi-nivel-{min(nivel, 5)}'
        
        # Formatar alíquota para exibição
        aliq_display = ''
        if aliquota and aliquota.strip():
            aliq_display = aliquota.strip()
            if aliq_display.isdigit():
                aliq_display += '%'
        else:
            # Se não tem alíquota, manter vazio para evitar poluição visual em categorias
            aliq_display = ''
        
        element_id = generate_anchor_id(codigo)

        return f'''<article class="tipi-position {indent_class}" id="{element_id}" data-ncm="{ncm}" aria-label="NCM {codigo}">
    <span class="tipi-ncm smart-link" data-ncm="{ncm}" role="link" tabindex="0">{codigo}</span>
    <span class="tipi-desc">{descricao}</span>
    <span class="tipi-aliquota {aliq_class}" data-tooltip="{tooltip}" aria-label="{tooltip}">{aliq_display}</span>
</article>'''

    
    @classmethod
    def render_chapter(cls, chapter: Dict[str, Any]) -> str:
        """Renderiza um capítulo completo com suas posições."""
        cap_codigo = chapter.get('capitulo', '')
        cap_titulo = chapter.get('titulo', f'Capítulo {cap_codigo}')
        posicoes = chapter.get('posicoes', [])
        
        positions_html = '\n'.join([cls.render_position(p) for p in posicoes])
        
        return f'''
<div class="tipi-chapter" id="cap-{cap_codigo}">
    <h2 class="tipi-chapter-header">
        <span class="tipi-cap-badge">{cap_codigo}</span>
        {cap_titulo}
    </h2>
    <div class="tipi-positions">
        {positions_html}
    </div>
</div>'''
    
    @classmethod
    def render_full_response(cls, resultados: Dict[str, Any]) -> str:
        """Renderiza resposta completa de busca TIPI."""
        if not resultados:
            return '<p class="empty">Nenhum resultado encontrado na TIPI.</p>'
        
        html_parts = []
        
        for cap_key, cap_data in sorted(resultados.items(), key=lambda kv: str(kv[0])):
            html_parts.append(cls.render_chapter(cap_data))
        
        return '\n'.join(html_parts)
    
    @classmethod
    def render_text_results(cls, results: List[Dict[str, Any]]) -> str:
        """Renderiza lista de resultados de busca textual."""
        if not results:
            return '<p class="empty">Nenhum resultado encontrado.</p>'
        
        items = []
        for r in results:
            aliq_class = cls.get_aliquot_class(r.get('aliquota', '0'))
            aliq = r.get('aliquota', '0')
            if aliq and aliq.isdigit():
                aliq += '%'
            
            items.append(f'''
<div class="tipi-result-item" data-ncm="{r.get('ncm', '')}">
    <span class="tipi-result-ncm smart-link" data-ncm="{r.get('ncm', '')}">{r.get('ncm', '')}</span>
    <span class="tipi-result-cap">Cap. {r.get('capitulo', '')}</span>
    <span class="tipi-result-desc">{HtmlRenderer.inject_exclusion_highlights(HtmlRenderer.inject_unit_highlights(r.get('descricao', '')))}</span>
    <span class="tipi-result-aliq {aliq_class}">{aliq}</span>
</div>''')
        
        return f'<div class="tipi-results-list">{"".join(items)}</div>'
