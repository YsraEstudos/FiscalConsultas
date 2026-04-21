from typing import Any, TypeAlias, TypedDict

from ...domain import ServiceResponse

NeshFtsCacheKey: TypeAlias = tuple[str, int, int, int, int]


class NeshChapterSectionPayload(TypedDict, total=False):
    titulo: str | None
    notas: str | None
    consideracoes: str | None
    definicoes: str | None


class NeshChapterRawPayload(TypedDict, total=False):
    chapter_num: str
    content: str
    notes: str | None
    parsed_notes_json: str | bytes | dict[str, str] | None
    parsed_notes: dict[str, str]
    positions: list[dict[str, Any]]
    sections: NeshChapterSectionPayload | None


class NeshChapterSearchResult(TypedDict, total=False):
    ncm_buscado: str
    capitulo: str
    posicao_alvo: str | None
    posicoes: list[dict[str, Any]]
    notas_gerais: str | None
    notas_parseadas: dict[str, str]
    conteudo: str
    real_content_found: bool
    erro: str | None
    secoes: dict[str, str | None] | None


NeshChapterSearchResultMap: TypeAlias = dict[str, NeshChapterSearchResult]


class NeshChapterSearchResponse(TypedDict):
    success: bool
    type: str
    query: str
    normalized: str | None
    results: NeshChapterSearchResultMap
    total_capitulos: int


class NeshFtsScoredRow(TypedDict, total=False):
    ncm: str
    display_text: str
    type: str
    description: str
    score: int | float
    tier: int
    rank: int | float
    near_bonus: bool


class NeshFtsResponseItem(TypedDict):
    ncm: str
    descricao: str
    tipo: str
    relevancia: int | float
    score: int | float
    tier: int
    tier_label: str
    near_bonus: bool


class NeshFtsSearchResponse(TypedDict):
    success: bool
    type: str
    query: str
    normalized: str
    match_type: str
    warning: str | None
    results: list[NeshFtsResponseItem]
    total_capitulos: int


class NeshFtsMatchMetadata(TypedDict):
    match_type: str
    warning: str | None
    best_tier: int


NeshServiceResponse: TypeAlias = ServiceResponse
