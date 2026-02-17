/**
 * Gera um ID único e seguro para âncoras HTML de posições NCM.
 * Deve estar em sincronia com `src/utils/id_utils.py` no backend.
 * 
 * Regra:
 * - Remove caracteres não alfanuméricos (exceto ponto e traço)
 * - Substitui pontos por traços
 * - Adiciona prefixo 'pos-'
 * 
 * @param ncmCode Código NCM para gerar o ID
 * @returns ID para uso em href ou id
 */
/**
 * Normaliza query de busca para formato de POSIÇÃO NCM (XX.XX).
 * Extrai os primeiros 4 dígitos para encontrar a posição na sidebar.
 * 
 * Exemplos:
 * - "8417" → "84.17"
 * - "4908.90.00" → "49.08" 
 * - "49089000" → "49.08"
 * - "84" → "84"
 * 
 * @param query Query de busca do usuário
 * @returns Código de posição no formato XX.XX
 */
export function normalizeNCMQuery(query: string | null | undefined): string {
    if (!query) return "";

    // Remove tudo que não é número
    const digits = query.replace(/[^0-9]/g, '');

    // Para NCMs completos (6-10 dígitos), extrair apenas os primeiros 4 (posição)
    if (digits.length >= 4) {
        const first4 = digits.slice(0, 4);
        return `${first4.slice(0, 2)}.${first4.slice(2)}`;
    }

    // Se tem 2 dígitos, pode ser capítulo
    if (digits.length === 2) {
        return digits;
    }

    // Fallback: retorna como está
    return query.trim();
}

/**
 * Normaliza um NCM para o formato esperado pela TIPI (com pontos).
 * Mantém a regra do backend (format_ncm_tipi) para consistência.
 *
 * Exemplos:
 * - "84139190" -> "8413.91.90"
 * - "841311" -> "8413.11"
 * - "8404" -> "84.04"
 * - "84.04" -> "84.04"
 */
export function formatNcmTipi(ncm: string | null | undefined): string {
    if (!ncm) return "";

    const digits = ncm.replace(/[^0-9]/g, "");
    if (!digits) return (ncm || "").trim();

    if (digits.length === 8) {
        return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
    }
    if (digits.length === 7) {
        return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
    }
    if (digits.length === 6) {
        return `${digits.slice(0, 4)}.${digits.slice(4, 6)}`;
    }
    if (digits.length === 5) {
        return `${digits.slice(0, 4)}.${digits.slice(4)}`;
    }
    if (digits.length === 4) {
        return `${digits.slice(0, 2)}.${digits.slice(2, 4)}`;
    }
    if (digits.length === 2) {
        return digits;
    }

    return digits;
}

export function generateAnchorId(ncmCode: string | null | undefined): string {
    if (!ncmCode) return "";

    // Idempotent: if already formatted, return as-is
    if (ncmCode.startsWith("pos-")) return ncmCode;

    // Security: Remove unsafe chars (compatível com regex do backend `[^a-zA-Z0-9\.\-]`)
    const safeChars = ncmCode.replace(/[^a-zA-Z0-9.-]/g, "");

    // Substitui pontos por traços
    const cleanCode = safeChars.trim().replace(/\./g, "-");

    return `pos-${cleanCode}`;
}

export function generateChapterId(chapter: string | number): string {
    const value = String(chapter).trim();
    if (!value) return "chapter-";
    if (value.startsWith("chapter-")) return value;
    if (value.startsWith("cap-")) return `chapter-${value.slice(4)}`;
    return `chapter-${value}`;
}
