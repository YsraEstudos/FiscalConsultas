# Dockerfile para Produção (Render.com + Railway)
# Alinhado com Python 3.13 e o gerenciador UV

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

RUN groupadd --system app \
    && useradd --system --gid app --create-home --home-dir /home/app --shell /usr/sbin/nologin app

WORKDIR /app

# Copiar arquivos de dependência primeiro para aproveitar cache
COPY pyproject.toml uv.lock ./

# Instalar dependências de produção (sem o grupo dev)
RUN uv sync --frozen --no-dev

# Copiar o restante do código
COPY backend migrations scripts ./
COPY Nesh.py alembic.ini README.md ./
RUN mkdir -p database \
    && chown -R app:app /app

# Configurações de ambiente para o container
ENV PYTHONUNBUFFERED=1
ENV SERVER__ENV=production
ENV SERVER__HOST=0.0.0.0
ENV SERVER__PORT=10000

# Porta padrão exposta pelo Render
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["python", "-c", "import os,sys,urllib.request; port=os.environ.get('PORT') or os.environ.get('SERVER__PORT') or '10000'; response=urllib.request.urlopen(f'http://127.0.0.1:{port}/api/status', timeout=3); sys.exit(0 if 200 <= response.status < 400 else 1)"]

USER app

# Comando para iniciar o servidor via uv
CMD ["uv", "run", "Nesh.py"]
