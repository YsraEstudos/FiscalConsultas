# Database Recommendations for Nesh/Fiscal Project

Based on the analysis of your codebase (`database.py`, `rebuild_index.py`), specifically the read-heavy nature, Full-Text Search (FTS) requirements, and current SQLite implementation.

## Part 1: Top 10 Improvements for Current Database (SQLite)

These improvements act on your **existing SQLite architecture** without needing to migrate to a new engine immediately.

1. **Migrate to Async ORM (SQLAlchemy/SQLModel)**
    * **Why:** Currently using raw SQL strings (`SELECT ... FROM`). This is brittle and error-prone.
    * **Benefit:** Better readability, type safety, and automatic prevention of SQL injection. SQLModel is great for modern Python/FastAPI apps.

2. **Implement Alembic for Migrations**
    * **Why:** Currently, `rebuild_index.py` destroys and recreates the DB. This prevents maintaining user data (e.g., user favorites/history) if the schema changes.
    * **Benefit:** Allows evolving the database schema non-destructively.

3. **Data Validation Layer (Pydantic)**
    * **Why:** Data is inserted directly from dictionary/parsing logic without strict validation.
    * **Benefit:** Ensures data integrity before it even touches the database.

4. **Advanced Full-Text Search (FTS5) Tuning**
    * **Why:** Currently using standard tokenizers and a complex manual Stemming processor.
    * **Benefit:** SQLite FTS5 supports custom tokenizers (via Python extensions or built-ins like `unicode61` with remove_diacritics). Optimizing this can remove the need for pre-processing text in Python.

5. **Add Vector Search (Semantic Search)**
    * **Why:** Users might not know the exact term "arruela" but might search for "disco de fixação".
    * **Benefit:** Using `sqlite-vec` extension allows "Meaning-based" search alongside keyword search, drastically improving NCM discovery.

6. **Incremental ETL Strategy**
    * **Why:** `rebuild_index.py` is a "stop-the-world" script.
    * **Benefit:** Modify scripts to `UPSERT` (Update if exists, Insert if new) chapters. This allows updating just one chapter without downtime.

7. **Database Backup & Replication (Litestream)**
    * **Why:** If the file corrupts, data is lost (though re-buildable from text, user data would be lost).
    * **Benefit:** Tools like Litestream can stream SQLite changes (WAL) to S3/Cloud continuously for real-time backup.

8. **Redis Caching Layer**
    * **Why:** Some NCMs or Chapters are accessed constantly.
    * **Benefit:** Cache hot results in Redis to bypass SQLite entirely for 90% of requests, sub-millisecond response times.

9. **Connection Pool Optimization**
    * **Why:** `pool_size=5` allows only 5 concurrent requests.
    * **Benefit:** Increase pool size or implement a separate "Reader Pool" (larger) vs "Writer Pool" (single/serialized) to handle traffic spikes.

10. **Strict Type Safety & Error Handling**
    * **Why:** Generic `Dict[str, Any]` returns make frontend development harder to debug.
    * **Benefit:** Return typed Objects/dataclasses from the adapter. Explicit custom exceptions (already started, but expand coverage).

---

## Part 2: Top 10 Best Databases for This Site (Alternatives)

If you decide to **switch** technologies to "The Best" for a Search-Heavy NCM Logic engine:

1. **PostgreSQL (The Gold Standard)**
    * **Best For:** Everything. Reliability, Scale, Features.
    * **Why:** Native FTS (tsvector) is robust. Native JSONB for unstructured notes. `pgvector` for AI search. Supports massive concurrency. One DB to rule them all.

2. **Meilisearch (The Search Specialist)**
    * **Best For:** "Instant-search-as-you-type" experience.
    * **Why:** Designed specifically for typo-tolerance (essential for NCM description/names) and speed. Much easier to configure than Elasticsearch.

3. **Typesense**
    * **Best For:** Open Source Algolia alternative.
    * **Why:** Extremely fast in-memory search engine. If your dataset fits in RAM (NCM data likely does), this is unbeatable for search speed.

4. **Supabase**
    * **Best For:** "Fastest to Professional".
    * **Why:** It IS Postgres, but managed. Gives you Realtime subscriptions, Auth, and automatic APIs. Great for "professionalizing" quickly.

5. **Elasticsearch / OpenSearch**
    * **Best For:** Complex enterprise search queries.
    * **Why:** Overkill for just NCMs, but if you need complex faceting (filtering by multiple categories, heavy analytics on search terms), this is the industry titan.

6. **Turso (Distributed SQLite)**
    * **Best For:** Global performance (Edge).
    * **Why:** Keep your SQLite code! But it replicates data to the Edge (servers close to users). Great for reading NCMs fast from anywhere in Brazil/World.

7. **Algolia**
    * **Best For:** Hosted, zero-maintenance search.
    * **Why:** Expensive, but provides the absolute best UX features (typo tolerance, synonyms, highlighting) out of the box with zero backend code maintenance.

8. **Qdrant**
    * **Best For:** AI-First Application.
    * **Why:** If "Nesh" is going to be an AI Assistant first, using a dedicated Vector Database like Qdrant is optimal for handling embeddings and semantic context.

9. **Redis (as Primary Lookup)**
    * **Best For:** Key-Value speed.
    * **Why:** If users mostly lookup by ID "8412.90", Redis is the fastest possible store. Can be used as a hybrid store with Redis Stack (Search + JSON).

10. **TiDB (NewSQL) or CockroachDB**
    * **Best For:** Infinite Scale (Google-scale).
    * **Why:** Likely overkill now, but if you plan to serve millions of simultaneous fiscal queries, these dist-SQL databases handle scale automatically.
