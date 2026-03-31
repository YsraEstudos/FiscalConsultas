# Dockerfile para Produção (Render.com + Railway)
# Alinhado com Python 3.13 e o gerenciador UV

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

RUN useradd -m -s /bin/bash appuser && mkdir -p /app/database && chown -R appuser:appuser /app
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar arquivos de dependência primeiro para aproveitar cache
COPY --chown=appuser:appuser pyproject.toml uv.lock ./

USER appuser

# Instalar dependências de produção (sem o grupo dev)
RUN uv sync --frozen --no-dev

# Copiar o restante do código
COPY --chown=appuser:appuser backend/ ./backend/
COPY --chown=appuser:appuser migrations/ ./migrations/
COPY --chown=appuser:appuser scripts/ ./scripts/
COPY --chown=appuser:appuser Nesh.py alembic.ini README.md ./

# Configurações de ambiente para o container
ENV PYTHONUNBUFFERED=1
ENV SERVER__ENV=production
ENV SERVER__HOST=0.0.0.0
ENV SERVER__PORT=10000

# Porta padrão exposta pelo Render
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:10000/system/status || exit 1

# Comando para iniciar o servidor via uv
CMD ["uv", "run", "Nesh.py"]
