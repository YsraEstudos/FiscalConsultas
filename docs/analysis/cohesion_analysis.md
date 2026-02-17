# NESH Codebase Cohesion Analysis

This document outlines areas where logic is currently fragmented across the codebase and proposes a strategy to unify them for better maintainability and reliability.

## 🚨 Critical Findings: Logic Fragmentation

### 1. Script Boilerplate & Logic Duplication

Scripts `scripts/setup_database.py` and `scripts/rebuild_index.py` are almost identical in how they:

- Setup system paths (hacky `sys.path.append`).
- Define the SQLite Schema (raw SQL strings duplicated).
- Construct file paths.

**Impact:**

- Changing the DB schema requires editing 3 files (`db_schema.py`, `setup_database.py`, `rebuild_index.py`).
- Risk of one script becoming out-of-sync creates "phantom bugs" where dev environment works but production build fails.

### 2. NESH Text Parsing (The "Regex Soup")

The most significant issue is the duplication of logic for parsing NESH content (NCM codes, Notes, Chapters). At least **4 different files** implement their own slightly different regexes and parsing logic for the same data structure.

| Scope | File | Logic / Regex | Risk |
|-------|------|---------------|------|
| **Ingestion** | `scripts/setup_database.py` | `extract_positions_from_chapter`, `extract_chapter_notes` | DB might contain data that the Renderer cannot display. |
| **Ingestion** | `scripts/ingest_markdown.py` | `ncm_pattern`, `chapter_start_re` | Alternate ingestion path with *different* rules. |
| **Service** | `backend/services/nesh_service.py` | `_RE_NOTE_HEADER`, `parse_chapter_notes` | Business logic might see "Notes" differently than the User. |
| **Presentation** | `backend/presentation/renderer.py` | `RE_NCM_HEADING`, `RE_NCM_SUBHEADING`, `RE_NOTE_REF` | HTML rendering might break for valid data if regex differs from ingestion. |

**Impact:**

- If the source format changes slightly (e.g., a new dash type), you must fix it in 4 places.
- Discrepancies lead to "Ghost Data": The DB says a position exists, but the Renderer can't link to it because it generates the ID differently.

### 3. Anemic Domain Models & Frontend Duplication

The backend uses `TypedDict` for models (`backend/domain/models.py`), which essentially treats data as dumb dictionaries. This forces all validation and manipulation logic into Services and Utils, leading to specific logic (like "Is this a valid NCM?") being repeated.

Additionally, the Frontend (`client/src/types/api.types.ts`) manually re-defines these structures.

| Backend Model (`models.py`) | Frontend Type (`api.types.ts`) | Status |
|-----------------------------|--------------------------------|--------|
| `Position` | `ChapterPosition` | **Duplicated**. Frontend adds `nivel` which might be missing in backend type. |
| `SearchResult` | `ChapterData` | **Duplicated**. Complex nested structures are manually kept in sync. |
| `ServiceResponse` | `NeshSearchResponse` | **Duplicated**. |

**Impact:**

- Backend changes (e.g., adding a field) require manual updates in Frontend types.
- no "Single Source of Truth" for what a "Position" object *can do* (e.g., methods like `position.is_chapter_level()`).

## 🛠 Proposed Refactoring Plan

### Phase 1: Unify Parsing Logic (The "Core Library")

Create a structured module `backend/pkg/nesh_parser` (or similar) that is the **canonical authority** on NESH text format.

- **`regex.py`**: A single file exporting compiling Regex patterns.
  - `NCM_PATTERN`: Used by ingestion, service, and renderer.
  - `NOTE_HEADER_PATTERN`: Used by parser and service.
- **`parser.py`**: A pure-python module (no DB dependencies) that takes raw text and returns Domain Objects.
  - `parse_chapter(text) -> Chapter`
  - `extract_positions(text) -> List[Position]`
- **Refactor Consumers**:
  - Update `setup_database.py` to use `parser.extract_positions`.
  - Update `renderer.py` to use `regex.NCM_PATTERN` for identifying lines to headline.

### Phase 2: Rich Domain Models (Pydantic)

Migrate `TypedDict` in `backend/domain/models.py` to **Pydantic Models**.

```python
# backend/domain/models.py
from pydantic import BaseModel, computed_field

class Position(BaseModel):
    codigo: str
    descricao: str
    
    @computed_field
    def anchor_id(self) -> str:
        return f"pos-{self.codigo.replace('.', '-')}"
```

**Benefits:**

- **Centralized Logic**: `anchor_id` generation happens ONCE, in the model. No more `generate_anchor_id` util called in 5 places.
- **Validation**: Ensure data consistency at the boundary.
- **Frontend Sync**: We can potentially generate TypeScript interfaces from Pydantic models (using tools like `datamodel-code-generator` or manually but with stricter guarantees).

### Phase 3: Cleanup Scripts

Refactor `scripts/` to import logic from `backend/`. Scripts should be thin wrappers around calls to the Backend logic.

- `setup_database.py` should import `backend.services.ingestion.ingest_chapter` instead of implementing parsing itself.

### Phase 4: Service Layer Unification (The "Engine" Pattern)

Both `NeshService` and `TipiService` duplicate 80% of their code (Code Search, Text Search, Caching, Connection Pooling).

Create a `backend/infrastructure/search_engine.py` that handles:

1. **Connection Pooling**: logic currently in `database.py` and `tipi_service.py`.
2. **FTS Abstraction**: A single `search_text(query, table_name)` method that handles the SQLite/Postgres switch.
3. **Cache Decorators**: Remove manual `OrderedDict` management and use a standard `@cached_search` decorator or a `CacheManager` class.

### Phase 5: Rendering Strategy Decision

Currently, the App has a "Split Brain" rendering strategy:

- **Primary**: Backend renders HTML (`renderer.py`).
- **Fallback**: Frontend renders HTML (`NeshRenderer.ts`) if backend sends raw data.

**Risk**: If you update the regex in `renderer.py` (e.g., to support a new Note format), the Frontend Fallback will break or display incorrectly if it ever activates.
**Action**:

- Decision: **Commit to Server-Side Rendering (SSR)** for NESH content.
- Remove `NeshRenderer.ts` and ensure the Backend *always* returns `markdown` (or `html`).
- If offline support is needed, the Frontend should cache the *HTML*, not the raw JSON.
