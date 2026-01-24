"""
Constantes centralizadas do Nesh.
Todos os magic numbers e strings hardcoded devem ser definidos aqui.
"""
from enum import Enum


class ApiRoutes:
    """Rotas da API REST."""
    SEARCH = "/api/search"
    CHAPTERS = "/api/chapters"


class HttpHeaders:
    """Headers HTTP padrão."""
    CONTENT_TYPE_JSON = "application/json; charset=utf-8"
    CORS_ALLOW_ALL = "*"


class CacheConfig:
    """Configurações de cache."""
    CHAPTER_CACHE_SIZE = 32  # Número de capítulos em LRU cache


class PerformanceConfig:
    """Configurações de performance."""
    CONNECTION_POOL_SIZE = 5      # Conexões SQLite no pool
    GZIP_MIN_SIZE = 1024          # Tamanho mínimo para compressão (bytes)
    GZIP_COMPRESSION_LEVEL = 6    # Nível de compressão (1-9)


class SearchConfig:
    """Configurações de busca."""
    MAX_FTS_RESULTS = 50     # Limite de resultados Full-Text Search
    MAX_QUERY_LENGTH = 500   # Tamanho máximo da query
    MIN_QUERY_LENGTH = 2     # Tamanho mínimo de query
    
    # Limites por tier de relevância
    TIER1_LIMIT = 10   # Exact phrase matches
    TIER2_LIMIT = 20   # All words (AND) matches
    TIER3_LIMIT = 20   # Partial (OR) matches
    
    # Pontuação base por tier
    TIER1_BASE_SCORE = 1000  # Correspondência exata
    TIER2_BASE_SCORE = 500   # Todas as palavras
    TIER3_BASE_SCORE = 100   # Parcial
    
    # Bônus de proximidade (NEAR)
    NEAR_DISTANCE = 5        # Palavras de distância máxima
    NEAR_BONUS = 200         # Bônus adicional por proximidade


class DatabaseConfig:
    """Configurações do banco de dados."""
    DEFAULT_PORT = 8000
    DEFAULT_DB_FILENAME = "database/nesh.db"


class ViewMode(str, Enum):
    """Modos de visualização da TIPI.
    
    FAMILY: Retorna apenas família NCM (posição + ancestrais + descendentes)
    CHAPTER: Retorna capítulo completo
    """
    FAMILY = "family"
    CHAPTER = "chapter"
    

class ServerConfig:
    """Configurações do servidor."""
    VERSION = "4.2"
    VERSION_NAME = "Performance Edition"


class RegexPatterns:
    """Padrões regex usados na aplicação."""
    # Padrão para detectar NCM numérico
    NCM_NUMERIC = r'^[\d\.,\s-]+$'
    
    # Padrão para referências a notas
    NOTE_REFERENCE = r'(?i)\b(nota[s]?\s+(\d+))(?:\s+(?:do|da|de)\s+cap[ií]tulo\s+(\d{1,2}))?'
    
    # Padrão para links NCM
    NCM_LINK = r'\b(\d{2}\.\d{2}(?:\.\d{2}\.\d{2})?|\d{4}\.\d{2})\b'
    
    # Padrão para limpar páginas
    CLEAN_PAGE = r'Página \d+\r?\n'
    
    # Padrão para limpar espaços extras
    CLEAN_SPACES = r'\n\s*\n\s*\n+'
    
    # Padrão para parsing de notas
    NOTE_HEADER = r'^(\d+)\s*[\.\\-]+\s'
    
    # Padrão para termos de exclusão (Caça-Exceções)
    EXCLUSION_TERMS = r'(?i)\b(exceto[s]?|excluindo|excluem-se|não compreende|excetuados?|exclusão|exclui|salvo)\b'
    
    # Padrão para unidades de medida (Raio-X de Unidades)
    # NOTE: Evitamos \b porque falha com símbolos não-\w (ex.: °C, m², m³/h).
    # Para evitar falsos positivos, unidades de 1 letra só casam quando vêm após um número.
    # Importante: não usamos "um" como alias de micrômetro (colide com o artigo "um").
    MEASUREMENT_UNITS = (
        r'(?i)'
        r'(?:'
        r'(?<![A-Za-zÀ-ÿ_])'
        r'(?:'
        r'kWh|MWh|Wh|'
        r'kVA|VA|'
        r'kW|MW|'
        r'mV|kV|'
        r'mA|kA|'
        r'Ah|mAh|'
        r'Hz|kHz|MHz|GHz|'
        r'rpm|'
        r'mbar|bar|MPa|kPa|Pa|'
        r'°C|ºC|°F|Kelvin|'
        r'kg|mg|'
        r'toneladas?|'
        r'litros?|litro|ml|'
        r'km|cm|mm|µm|nm|'
        r'ha|'
        r'm³/h|m3/h|'
        r'm³|m3|m²|m2|'
        r'cm³|cm3|cm²|cm2|'
        r'mm³|mm3|mm²|mm2'
        r')'
        r'(?![A-Za-zÀ-ÿ_])'
        r'|'
        # Unidades de 1 letra: aceitam 0-3 espaços após o número, mas o match começa na unidade
        r'(?:(?<=\d)|(?<=\d\s)|(?<=\d\s\s)|(?<=\d\s\s\s))'
        r'(?:W|V|A|K|m|l|t|g)'
        r'(?![A-Za-zÀ-ÿ0-9_])'
        r')'
    )


class Messages:
    """Mensagens do sistema."""
    SERVER_STARTED = "🚀 Servidor Nesh v{version} ({name}) iniciado!"
    SERVER_STOPPED = "👋 Servidor encerrado."
    DB_NOT_FOUND = "❌ Banco de dados não encontrado em: {path}"
    DB_RUN_SETUP = "Execute: python scripts/rebuild_index.py (recomendado)"
    CONFIG_ERROR = "⚠️ Erro ao carregar config ({error}). Usando defaults."
    
    # Erros HTTP
    MISSING_NCM_PARAM = "Parâmetro 'ncm' é obrigatório"
    CHAPTER_NOT_FOUND = "Capítulo {chapter} não encontrado"
