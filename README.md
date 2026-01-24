# Nesh / Fiscal

Sistema de consulta de NCM local híbrido (Python/FastAPI + React).

## 🚀 Quick Start

### Pré-requisitos
- Python 3.10+
- Node.js 18+

### Setup Inicial (Backend) (Execute apenas na primeira vez)
Carregue os dados do NESH e da TIPI para os bancos SQLite.
```bash
python scripts/setup_database.py
python scripts/setup_tipi_database.py
```

### Rodar Aplicação

1. **Backend (Terminal 1)**
   Inicia a API FastAPI na porta 8000.
   ```bash
   python Nesh.py
   ```

2. **Frontend (Terminal 2)**
   Inicia o servidor de desenvolvimento Vite (com HMR).
   ```bash
   cd client
   npm install
   npm run dev
   ```

Acesse: `http://localhost:5173`

---

## 🏗 Arquitetura

*   **Backend:** `backend/server/app.py` (FastAPI) serve a API e o bundle do frontend em produção.
*   **Frontend:** `client/src` (React + TS + Vite). Usa proxy para conectar ao backend em dev.
*   **Dados:**
    *   `nesh.db`: Notas Explicativas + Full-Text Search (FTS5).
    *   `tipi.db`: Tabela TIPI e alíquotas.

## 📚 Documentação Técnica

Para detalhes profundos sobre a lógica de busca, renderização e contratos entre frontend e backend, consulte:
👉 [docs/AI_CONTEXT.md](docs/AI_CONTEXT.md)

> **Nota para IAs:** O arquivo `AI_CONTEXT.md` é a fonte da verdade para manutenção deste projeto.

## 🛠 Comandos Úteis

| Ação | Comando |
| :--- | :--- |
| **Testes Backend** | `pytest` |
| **Testes Frontend** | `cd client && npm run test` |
| **Build Prod** | `cd client && npm run build` (Gera assets em `client/dist`)

## 📝 Notas sobre NESH (Formatação)

- O backend normaliza títulos, bullets e converte `**texto**` para `<strong>`, garantindo que headings e destaques fiquem consistentes.
- O frontend encapsula cada seção NESH (`h3.nesh-section`) em um card visual, mantendo o texto principal e subtítulos agrupados.
- Para detalhes técnicos e contratos de renderização, veja [docs/AI_CONTEXT.md](docs/AI_CONTEXT.md).
