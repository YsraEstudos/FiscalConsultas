from typing import TypedDict


class TipiPositionRow(TypedDict, total=False):
    ncm: str
    capitulo: str
    descricao: str
    aliquota: str | None
    nivel: int


class TipiCodePositionPayload(TypedDict):
    ncm: str
    codigo: str
    descricao: str
    aliquota: str
    nivel: int
    anchor_id: str


class TipiCodeChapterPayload(TypedDict):
    capitulo: str
    titulo: str
    notas_gerais: None
    posicao_alvo: str | None
    posicoes: list[TipiCodePositionPayload]


type TipiChapterResultsMap = dict[str, TipiCodeChapterPayload]
type TipiRowBatch = tuple[TipiPositionRow, ...]
type TipiCodeCacheKey = tuple[str, str]


class TipiCodeSearchPayload(TypedDict):
    success: bool
    type: str
    query: str
    results: TipiChapterResultsMap
    resultados: TipiChapterResultsMap
    total: int
    total_capitulos: int


class TipiTextSearchItem(TypedDict):
    ncm: str
    capitulo: str
    descricao: str
    aliquota: str


class TipiTextSearchPayload(TypedDict):
    success: bool
    type: str
    query: str
    normalized: str
    match_type: str
    warning: None
    total: int
    results: list[TipiTextSearchItem]


class TipiChapterCatalogItem(TypedDict):
    codigo: str
    titulo: str
    secao: str


class TipiRepositoryHealthPayload(TypedDict, total=False):
    status: str
    chapters: int
    positions: int
    metadata: dict[str, str]
    error: str


class TipiSqliteHealthPayload(TypedDict, total=False):
    ok: bool
    chapters: int
    positions: int
    error: str


type TipiHealthPayload = TipiRepositoryHealthPayload | TipiSqliteHealthPayload
