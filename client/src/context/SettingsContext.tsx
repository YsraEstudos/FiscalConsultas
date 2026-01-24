import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { TipiViewMode, VIEW_MODE_VALUES, STORAGE_KEYS, DEFAULTS } from '../constants';

interface SettingsContextType {
    theme: string;
    fontSize: number;
    highlightEnabled: boolean;
    adminMode: boolean;
    tipiViewMode: TipiViewMode;
    updateTheme: (newTheme: string) => void;
    updateFontSize: (newSize: number) => void;
    toggleHighlight: () => void;
    toggleAdminMode: () => void;
    updateTipiViewMode: (mode: TipiViewMode) => void;
    restoreDefaults: () => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
    // State
    const [theme, setTheme] = useState<string>(DEFAULTS.THEME);
    const [fontSize, setFontSize] = useState<number>(DEFAULTS.FONT_SIZE);
    const [highlightEnabled, setHighlightEnabled] = useState<boolean>(DEFAULTS.HIGHLIGHT);
    const [adminMode, setAdminMode] = useState<boolean>(DEFAULTS.ADMIN_MODE);
    const [tipiViewMode, setTipiViewMode] = useState<TipiViewMode>(DEFAULTS.TIPI_VIEW_MODE);

    // Initialization (Load from LocalStorage)
    useEffect(() => {
        try {
            const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
            if (savedTheme) setTheme(savedTheme);

            const savedSize = localStorage.getItem(STORAGE_KEYS.FONT_SIZE);
            if (savedSize) setFontSize(parseInt(savedSize));

            const savedHighlight = localStorage.getItem(STORAGE_KEYS.HIGHLIGHT);
            if (savedHighlight !== null) setHighlightEnabled(savedHighlight === 'true');

            const savedAdmin = localStorage.getItem(STORAGE_KEYS.ADMIN_MODE);
            if (savedAdmin !== null) {
                setAdminMode(savedAdmin === 'true');
            } else {
                // First time visit -> Default to TRUE (Admin on by default)
                setAdminMode(true);
            }

            const savedTipiView = localStorage.getItem(STORAGE_KEYS.TIPI_VIEW_MODE) as TipiViewMode | null;
            if (savedTipiView && VIEW_MODE_VALUES.includes(savedTipiView)) {
                setTipiViewMode(savedTipiView);
            }
        } catch (e) {
            console.error("Failed to load settings", e);
        }
    }, []);

    // Persist & Apply Effects
    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.THEME, theme);
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.FONT_SIZE, fontSize.toString());
        document.documentElement.style.fontSize = `${fontSize}px`;
    }, [fontSize]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.HIGHLIGHT, highlightEnabled.toString());
    }, [highlightEnabled]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.ADMIN_MODE, adminMode.toString());
    }, [adminMode]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.TIPI_VIEW_MODE, tipiViewMode);
    }, [tipiViewMode]);

    // Actions
    const updateTheme = (newTheme: string) => setTheme(newTheme);
    const updateFontSize = (newSize: number) => setFontSize(newSize);
    const toggleHighlight = () => setHighlightEnabled(prev => !prev);
    const toggleAdminMode = () => setAdminMode(prev => !prev);
    const updateTipiViewMode = (mode: TipiViewMode) => setTipiViewMode(mode);

    const restoreDefaults = () => {
        setTheme(DEFAULTS.THEME);
        setFontSize(DEFAULTS.FONT_SIZE);
        setHighlightEnabled(DEFAULTS.HIGHLIGHT);
        setAdminMode(DEFAULTS.ADMIN_MODE);
        setTipiViewMode(DEFAULTS.TIPI_VIEW_MODE);
    };

    return (
        <SettingsContext.Provider value={{
            theme,
            fontSize,
            highlightEnabled,
            adminMode,
            tipiViewMode,
            updateTheme,
            updateFontSize,
            toggleHighlight,
            toggleAdminMode,
            updateTipiViewMode,
            restoreDefaults
        }}>
            {children}
        </SettingsContext.Provider>
    );
}

export function useSettings() {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
}

// Re-export type for convenience
export type { TipiViewMode };
