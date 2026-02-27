import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import {
  TipiViewMode,
  VIEW_MODE_VALUES,
  STORAGE_KEYS,
  DEFAULTS,
  SidebarPosition,
  SIDEBAR_POSITION,
  AccentColor,
  ACCENT_COLOR_VALUES,
} from "../constants";

interface SettingsContextType {
  theme: string;
  accentColor: AccentColor;
  fontSize: number;
  highlightEnabled: boolean;
  adminMode: boolean;
  tipiViewMode: TipiViewMode;
  sidebarPosition: SidebarPosition;
  updateTheme: (newTheme: string) => void;
  updateAccentColor: (color: AccentColor) => void;
  updateFontSize: (newSize: number) => void;
  toggleHighlight: () => void;
  toggleAdminMode: () => void;
  updateTipiViewMode: (mode: TipiViewMode) => void;
  updateSidebarPosition: (position: SidebarPosition) => void;
  restoreDefaults: () => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

/**
 * Provides the SettingsContext and manages persistent user preferences and UI side effects.
 *
 * Initializes settings from localStorage, persists changes back to localStorage, applies related
 * DOM attributes and classes (theme, accent color, font size, highlight visibility, admin mode,
 * tipi view mode, and sidebar position), and exposes update/restore actions to consumers.
 *
 * @param children - React nodes that will receive the settings context
 * @returns The SettingsContext provider element wrapping the given children
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  // State
  const [theme, setTheme] = useState<string>(DEFAULTS.THEME);
  const [accentColor, setAccentColor] = useState<AccentColor>(
    DEFAULTS.ACCENT_COLOR,
  );
  const [fontSize, setFontSize] = useState<number>(DEFAULTS.FONT_SIZE);
  const [highlightEnabled, setHighlightEnabled] = useState<boolean>(
    DEFAULTS.HIGHLIGHT,
  );
  const [adminMode, setAdminMode] = useState<boolean>(DEFAULTS.ADMIN_MODE);
  const [tipiViewMode, setTipiViewMode] = useState<TipiViewMode>(
    DEFAULTS.TIPI_VIEW_MODE,
  );
  const [sidebarPosition, setSidebarPosition] = useState<SidebarPosition>(
    DEFAULTS.SIDEBAR_POSITION,
  );

  // Initialization (Load from LocalStorage)
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
      if (savedTheme) setTheme(savedTheme);

      const savedAccent = localStorage.getItem(
        STORAGE_KEYS.ACCENT_COLOR,
      ) as AccentColor | null;
      if (savedAccent && ACCENT_COLOR_VALUES.includes(savedAccent)) {
        setAccentColor(savedAccent);
      }

      const savedSize = localStorage.getItem(STORAGE_KEYS.FONT_SIZE);
      if (savedSize) setFontSize(parseInt(savedSize));

      const savedHighlight = localStorage.getItem(STORAGE_KEYS.HIGHLIGHT);
      if (savedHighlight !== null)
        setHighlightEnabled(savedHighlight === "true");

      const savedAdmin = localStorage.getItem(STORAGE_KEYS.ADMIN_MODE);
      if (savedAdmin !== null) {
        setAdminMode(savedAdmin === "true");
      } else {
        // First time visit -> Default to TRUE (Admin on by default)
        setAdminMode(true);
      }

      const savedTipiView = localStorage.getItem(
        STORAGE_KEYS.TIPI_VIEW_MODE,
      ) as TipiViewMode | null;
      if (savedTipiView && VIEW_MODE_VALUES.includes(savedTipiView)) {
        setTipiViewMode(savedTipiView);
      }

      const savedSidebarPos = localStorage.getItem(
        STORAGE_KEYS.SIDEBAR_POSITION,
      ) as SidebarPosition | null;
      if (
        savedSidebarPos &&
        (savedSidebarPos === SIDEBAR_POSITION.LEFT ||
          savedSidebarPos === SIDEBAR_POSITION.RIGHT)
      ) {
        setSidebarPosition(savedSidebarPos);
      }
    } catch (e) {
      console.error("Failed to load settings", e);
    }
  }, []);

  // Persist & Apply Effects
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ACCENT_COLOR, accentColor);
    document.documentElement.setAttribute("data-accent", accentColor);
  }, [accentColor]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.FONT_SIZE, fontSize.toString());
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.HIGHLIGHT, highlightEnabled.toString());
    // Ativar/desativar classes CSS no body para controlar visibilidade dos destaques
    const classes = [
      "disable-unit-highlights",
      "disable-exclusion-highlights",
      "disable-smart-links",
    ];
    if (highlightEnabled) {
      document.body.classList.remove(...classes);
    } else {
      document.body.classList.add(...classes);
    }
  }, [highlightEnabled]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ADMIN_MODE, adminMode.toString());
  }, [adminMode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TIPI_VIEW_MODE, tipiViewMode);
  }, [tipiViewMode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_POSITION, sidebarPosition);
  }, [sidebarPosition]);

  // Actions
  const updateTheme = (newTheme: string) => setTheme(newTheme);
  const updateAccentColor = (color: AccentColor) => setAccentColor(color);
  const updateFontSize = (newSize: number) => setFontSize(newSize);
  const toggleHighlight = () => setHighlightEnabled((prev) => !prev);
  const toggleAdminMode = () => setAdminMode((prev) => !prev);
  const updateTipiViewMode = (mode: TipiViewMode) => setTipiViewMode(mode);
  const updateSidebarPosition = (position: SidebarPosition) =>
    setSidebarPosition(position);

  const restoreDefaults = () => {
    setTheme(DEFAULTS.THEME);
    setAccentColor(DEFAULTS.ACCENT_COLOR);
    setFontSize(DEFAULTS.FONT_SIZE);
    setHighlightEnabled(DEFAULTS.HIGHLIGHT);
    setAdminMode(DEFAULTS.ADMIN_MODE);
    setTipiViewMode(DEFAULTS.TIPI_VIEW_MODE);
    setSidebarPosition(DEFAULTS.SIDEBAR_POSITION);
  };

  return (
    <SettingsContext.Provider
      value={{
        theme,
        accentColor,
        fontSize,
        highlightEnabled,
        adminMode,
        tipiViewMode,
        sidebarPosition,
        updateTheme,
        updateAccentColor,
        updateFontSize,
        toggleHighlight,
        toggleAdminMode,
        updateTipiViewMode,
        updateSidebarPosition,
        restoreDefaults,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

/**
 * Accesses the settings context value from the nearest SettingsProvider.
 *
 * @returns The current SettingsContext value.
 * @throws If called outside of a SettingsProvider.
 */
export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}

// Re-export type for convenience
export type { TipiViewMode };
