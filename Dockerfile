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
COPY database/ ./database/
COPY README.md .

# Configurações de ambiente para o container
ENV PYTHONUNBUFFERED=1
ENV SERVER__ENV=production
ENV SERVER__HOST=0.0.0.0
ENV SERVER__PORT=10000

# Porta padrão exposta pelo Render
EXPOSE 10000

# Comando para iniciar o servidor via uv
CMD ["uv", "run", "Nesh.py"]
