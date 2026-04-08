# Dockerfile para Produção (Render.com + Railway)
# Alinhado com Python 3.13 e o gerenciador UV

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

# Copiar arquivos de dependência primeiro para aproveitar cache
COPY pyproject.toml uv.lock ./

# Instalar dependências de produção (sem o grupo dev)
RUN uv sync --frozen --no-dev

# Copiar o restante do código
COPY backend/ ./backend/
COPY Nesh.py .
COPY alembic.ini .
COPY migrations/ ./migrations/
COPY scripts/ ./scripts/
RUN mkdir -p database/
COPY README.md .

# Configurações de ambiente para o container
ENV PYTHONUNBUFFERED=1
ENV SERVER__ENV=production
ENV SERVER__HOST=0.0.0.0
ENV SERVER__PORT=10000

# Porta padrão exposta pelo Render
EXPOSE 10000

# Install curl for HEALTHCHECK and configure non-root user
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/* && \
    useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app

USER appuser

# Healthcheck checking the status endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:10000/status || exit 1

# Comando para iniciar o servidor via uv
CMD ["uv", "run", "Nesh.py"]
