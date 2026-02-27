/**
 * Constantes centralizadas do frontend.
 *
 * Evita magic strings dispersas e facilita manutenção futura.
 */

// === TIPI View Modes ===
export const VIEW_MODE = {
  FAMILY: "family",
  CHAPTER: "chapter",
} as const;

export type TipiViewMode = (typeof VIEW_MODE)[keyof typeof VIEW_MODE];

// Array para validação (útil em loops/checks)
export const VIEW_MODE_VALUES: TipiViewMode[] = [
  VIEW_MODE.FAMILY,
  VIEW_MODE.CHAPTER,
];

// === Accent Colors ===
export const ACCENT_COLOR = {
  PURPLE: "purple",
  PINK: "pink",
  GREEN: "green",
  YELLOW: "yellow",
  RED: "red",
} as const;

export type AccentColor = (typeof ACCENT_COLOR)[keyof typeof ACCENT_COLOR];
export const ACCENT_COLOR_VALUES: AccentColor[] = Object.values(ACCENT_COLOR);

// === Sidebar Position ===
export const SIDEBAR_POSITION = {
  LEFT: "left",
  RIGHT: "right",
} as const;

export type SidebarPosition =
  (typeof SIDEBAR_POSITION)[keyof typeof SIDEBAR_POSITION];

// === LocalStorage Keys ===
export const STORAGE_KEYS = {
  THEME: "nesh_theme",
  ACCENT_COLOR: "nesh_accent_color",
  FONT_SIZE: "nesh_font_size",
  HIGHLIGHT: "nesh_highlight",
  ADMIN_MODE: "nesh_admin_mode",
  TIPI_VIEW_MODE: "nesh_tipi_view_mode",
  SIDEBAR_POSITION: "nesh_sidebar_position",
} as const;

// === Default Settings ===
export const DEFAULTS = {
  THEME: "dark",
  ACCENT_COLOR: ACCENT_COLOR.PURPLE,
  FONT_SIZE: 16,
  HIGHLIGHT: true,
  ADMIN_MODE: true,
  TIPI_VIEW_MODE: VIEW_MODE.CHAPTER,
  SIDEBAR_POSITION: SIDEBAR_POSITION.LEFT,
} as const;
