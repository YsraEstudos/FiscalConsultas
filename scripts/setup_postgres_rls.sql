-- ============================================================
-- Script de Configuração Row-Level Security (RLS) para PostgreSQL
-- ============================================================

-- 1. Habilitar RLS nas tabelas principais
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters FORCE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions FORCE ROW LEVEL SECURITY;
ALTER TABLE chapter_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapter_notes FORCE ROW LEVEL SECURITY;

-- 2. Definir Políticas de Segurança
-- Nota: 'app.current_tenant' é a variável de sessão definida pelo middleware/db_engine.
-- Nota: current_setting(..., true) retorna NULL se a variável não existir.
--       NULLIF(..., '') evita tenant vazio.

-- Política para tenants: Usuário só vê dados da sua própria organização
DROP POLICY IF EXISTS tenant_isolation_policy ON tenants;
CREATE POLICY tenant_isolation_policy ON tenants
    FOR ALL
    USING (id = NULLIF(current_setting('app.current_tenant', true), ''))
    WITH CHECK (id = NULLIF(current_setting('app.current_tenant', true), ''));

-- Política para chapters
DROP POLICY IF EXISTS chapter_isolation_policy ON chapters;
CREATE POLICY chapter_isolation_policy ON chapters
    FOR ALL
    USING (
        tenant_id IS NULL
        OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')
    )
    WITH CHECK (
        tenant_id IS NULL
        OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')
    );

-- Política para positions
DROP POLICY IF EXISTS position_isolation_policy ON positions;
CREATE POLICY position_isolation_policy ON positions
    FOR ALL
    USING (
        tenant_id IS NULL
        OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')
    )
    WITH CHECK (
        tenant_id IS NULL
        OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')
    );

-- Política para chapter_notes
DROP POLICY IF EXISTS chapter_notes_isolation_policy ON chapter_notes;
CREATE POLICY chapter_notes_isolation_policy ON chapter_notes
    FOR ALL
    USING (
        tenant_id IS NULL
        OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')
    )
    WITH CHECK (
        tenant_id IS NULL
        OR tenant_id = NULLIF(current_setting('app.current_tenant', true), '')
    );

-- 3. (Opcional) Política para usuários verem apenas colegas da mesma organização
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_isolation_policy ON users;
CREATE POLICY user_isolation_policy ON users
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), ''))
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), ''));

-- 4. Criar índices para otimizar a filtragem por tenant_id
CREATE INDEX IF NOT EXISTS idx_chapters_tenant ON chapters(tenant_id);
CREATE INDEX IF NOT EXISTS idx_positions_tenant ON positions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chapter_notes_tenant ON chapter_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
