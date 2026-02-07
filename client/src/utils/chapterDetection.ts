/**
 * Utilitarios de deteccao de capitulo
 * 
 * Funcoes puras para detectar capitulo do NCM e comparar com capitulos carregados.
 * Usado na otimizacao de navegacao no mesmo capitulo.
 */

/**
 * Extrai o numero do capitulo a partir de um NCM.
 * 
 * @param ncm - Codigo NCM em qualquer formato (ex.: "8422.1", "84.22", "842210", "8422")
 * @returns Numero do capitulo como string (ex.: "84") ou null se invalido
 * 
 * @example
 * extractChapter("8422.1") // "84"
 * extractChapter("84.22") // "84"
 * extractChapter("842210") // "84"
 * extractChapter("7308.10.00") // "73"
 * extractChapter("invalid") // null
 */
export function extractChapter(ncm: string): string | null {
    if (!ncm || typeof ncm !== 'string') return null;

    // Remove todos os caracteres nao numericos
    const digits = ncm.replace(/\D/g, '');

    // O capitulo do NCM sao sempre os 2 primeiros digitos
    if (digits.length >= 2) {
        return digits.slice(0, 2);
    }

    return null;
}

/**
 * Verifica se um NCM pertence a algum dos capitulos carregados.
 * 
 * @param ncm - NCM a verificar
 * @param loadedChapters - Lista de capitulos carregados (ex.: ["84", "73"])
 * @returns true se o NCM pertence a um capitulo carregado, false caso contrario
 * 
 * @example
 * isSameChapter("8422.1", ["84", "73"]) // true
 * isSameChapter("9401", ["84", "73"]) // false
 * isSameChapter("", ["84"]) // false
 */
export function isSameChapter(ncm: string, loadedChapters: string[]): boolean {
    const targetChapter = extractChapter(ncm);

    if (!targetChapter) return false;
    if (!Array.isArray(loadedChapters) || loadedChapters.length === 0) return false;

    return loadedChapters.includes(targetChapter);
}
