"""
Modelos de domínio do Nesh.
Define as estruturas de dados utilizadas em toda a aplicação.
"""

from typing import Dict, List, Optional, Any, Union, TypedDict


class Position(TypedDict):
    """
    Representa uma posição NCM dentro de um capítulo.
    
    Attributes:
        codigo: Código da posição (ex: "73.15", "85.07")
        descricao: Descrição resumida da posição
    """
    codigo: str
    descricao: str
    anchor_id: str  # ID único para navegação (ex: "pos-8517-10-00")


class ChapterData(TypedDict):
    """
    Dados brutos de um capítulo do banco de dados.
    
    Attributes:
        chapter_num: Número do capítulo (ex: "73", "85")
        content: Conteúdo textual completo do capítulo
        positions: Lista de posições NCM do capítulo
        notes: Texto das notas/regras gerais (raw)
        parsed_notes: Dicionário de notas parseadas {numero: conteudo}
    """
    chapter_num: str
    content: str
    positions: List[Position]
    notes: Optional[str]
    parsed_notes: Dict[str, str]


class SearchResult(TypedDict):
    """
    Resultado de busca por código NCM.
    
    Attributes:
        ncm_buscado: NCM original da query
        capitulo: Número do capítulo encontrado
        posicao_alvo: Posição específica se NCM tiver 4+ dígitos
        posicoes: Lista de todas as posições do capítulo
        notas_gerais: Texto das regras gerais
        notas_parseadas: Notas em formato de dicionário
        conteudo: Conteúdo completo do capítulo
        real_content_found: Se o capítulo existe no banco
        erro: Mensagem de erro (se houver)
    """
    ncm_buscado: str
    capitulo: str
    posicao_alvo: Optional[str]
    posicoes: List[Position]
    notas_gerais: Optional[str]
    notas_parseadas: Dict[str, str]
    conteudo: str
    real_content_found: bool
    erro: Optional[str]


class ServiceResponse(TypedDict):
    """
    Resposta padronizada do serviço de busca.
    
    Attributes:
        success: Se a operação foi bem-sucedida
        type: Tipo de busca ('code' ou 'text')
        query: Query original do usuário
        normalized: Query normalizada (para buscas FTS)
        results: Resultados da busca
        total_capitulos: Quantidade de capítulos retornados
    """
    success: bool
    type: str  # 'code' ou 'text'
    query: str
    normalized: Optional[str]
    results: Union[Dict[str, SearchResult], List[Dict[str, Any]]]
    total_capitulos: int
