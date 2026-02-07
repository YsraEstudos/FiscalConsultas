/**
 * Constantes centralizadas do frontend.
 * 
 * Evita magic strings dispersas e facilita manutenção futura.
 */

// === TIPI View Modes ===
export const VIEW_MODE = {
    FAMILY: 'family',
    CHAPTER: 'chapter',
} as const;

export type TipiViewMode = typeof VIEW_MODE[keyof typeof VIEW_MODE];

// Array para validação (útil em loops/checks)
export const VIEW_MODE_VALUES: TipiViewMode[] = [VIEW_MODE.FAMILY, VIEW_MODE.CHAPTER];

// === Sidebar Position ===
export const SIDEBAR_POSITION = {
    LEFT: 'left',
    RIGHT: 'right',
} as const;

export type SidebarPosition = typeof SIDEBAR_POSITION[keyof typeof SIDEBAR_POSITION];

// === LocalStorage Keys ===
export const STORAGE_KEYS = {
    THEME: 'nesh_theme',
    FONT_SIZE: 'nesh_font_size',
    HIGHLIGHT: 'nesh_highlight',
    ADMIN_MODE: 'nesh_admin_mode',
    TIPI_VIEW_MODE: 'nesh_tipi_view_mode',
    SIDEBAR_POSITION: 'nesh_sidebar_position',
} as const;

// === Default Settings ===
export const DEFAULTS = {
    THEME: 'dark',
    FONT_SIZE: 16,
    HIGHLIGHT: true,
    ADMIN_MODE: true,
    TIPI_VIEW_MODE: VIEW_MODE.CHAPTER,
    SIDEBAR_POSITION: SIDEBAR_POSITION.LEFT,
} as const;

