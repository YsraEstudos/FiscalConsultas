import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { SettingsModal } from "../../src/components/SettingsModal";
import { useSettings } from "../../src/context/SettingsContext";
import { SIDEBAR_POSITION, VIEW_MODE, ACCENT_COLOR } from "../../src/constants";
import { useIsAdmin } from "../../src/hooks/useIsAdmin";

// Mock the context hook
vi.mock("../../src/context/SettingsContext");
vi.mock("../../src/hooks/useIsAdmin");
vi.mock("../../src/context/LocalDatabaseContext", () => ({
  useLocalDatabase: () => ({
    status: "not_installed",
    searchLocal: vi.fn().mockResolvedValue(null),
    getNbsDetailLocal: vi.fn().mockResolvedValue(null),
    progress: 0,
    progressStep: "",
    localVersion: null,
    remoteVersion: null,
    updateAvailable: false,
    error: null,
    dbSizeBytes: null,
    isSupported: false,
    install: vi.fn(),
    remove: vi.fn(),
    refreshAvailability: vi.fn().mockResolvedValue(null),
  }),
}));

describe("SettingsModal Component", () => {
  const mockSettings = {
    theme: "dark",
    accentColor: ACCENT_COLOR.PURPLE,
    fontSize: 16,
    highlightEnabled: true,
    adminMode: false,
    tipiViewMode: VIEW_MODE.CHAPTER,
    sidebarPosition: SIDEBAR_POSITION.RIGHT,
    openNewTab: false,
    nbsPrefixAutoExpand: false,
    nbsChapterNotesNewTab: false,
    updateTheme: vi.fn(),
    updateAccentColor: vi.fn(),
    updateFontSize: vi.fn(),
    toggleHighlight: vi.fn(),
    toggleAdminMode: vi.fn(),
    updateTipiViewMode: vi.fn(),
    updateSidebarPosition: vi.fn(),
    toggleOpenNewTab: vi.fn(),
    toggleNbsPrefixAutoExpand: vi.fn(),
    toggleNbsChapterNotesNewTab: vi.fn(),
    restoreDefaults: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSettings).mockReturnValue(mockSettings as any);
    vi.mocked(useIsAdmin).mockReturnValue(true);
  });

  it("does not render when closed", () => {
    render(<SettingsModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText("Configurações")).not.toBeInTheDocument();
  });

  it("renders correctly when open", () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("Configurações")).toBeInTheDocument();
    expect(screen.getByText("Tema")).toBeInTheDocument();
    expect(screen.getByText("Tamanho da Fonte")).toBeInTheDocument();
    expect(screen.getByText("Realçar Resultados")).toBeInTheDocument();
    expect(screen.getByText("Comportamento de Navegação")).toBeInTheDocument();
    expect(screen.getByText("Modo Desenvolvedor")).toBeInTheDocument();
    expect(screen.getByText("Visualização TIPI")).toBeInTheDocument();
  });

  it("toggles navigation behavior", () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
    const newTabBtn = screen.getByText("Em nova aba");
    fireEvent.click(newTabBtn);
    expect(mockSettings.toggleOpenNewTab).toHaveBeenCalled();
  });

  it("switches theme", () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
    const lightBtn = screen.getByText("☀️ Claro");
    const darkBtn = screen.getByText("🌑 AMOLED");

    fireEvent.click(lightBtn);
    fireEvent.click(darkBtn);

    expect(mockSettings.updateTheme).toHaveBeenCalledWith("light");
    expect(mockSettings.updateTheme).toHaveBeenCalledWith("dark");
  });

  it("renders accent color buttons and updates accent color", () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    const purpleBtn = screen.getByTestId("accent-purple");
    const pinkBtn = screen.getByTestId("accent-pink");
    const greenBtn = screen.getByTestId("accent-green");
    const yellowBtn = screen.getByTestId("accent-yellow");
    const redBtn = screen.getByTestId("accent-red");

    expect(purpleBtn).toBeInTheDocument();
    expect(pinkBtn).toBeInTheDocument();
    expect(greenBtn).toBeInTheDocument();
    expect(yellowBtn).toBeInTheDocument();
    expect(redBtn).toBeInTheDocument();

    fireEvent.click(pinkBtn);
    expect(mockSettings.updateAccentColor).toHaveBeenCalledWith(
      ACCENT_COLOR.PINK,
    );

    fireEvent.click(greenBtn);
    expect(mockSettings.updateAccentColor).toHaveBeenCalledWith(
      ACCENT_COLOR.GREEN,
    );
  });

  it("updates font size", () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "18" } });
    expect(mockSettings.updateFontSize).toHaveBeenCalledWith(18);
  });

  it("toggles highlighting", () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
    const toggle = screen.getByTestId("highlight-toggle");
    fireEvent.click(toggle);
    expect(mockSettings.toggleHighlight).toHaveBeenCalled();
  });

  it("toggles admin mode", () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
    const toggle = screen.getByTestId("admin-toggle");
    fireEvent.click(toggle);
    expect(mockSettings.toggleAdminMode).toHaveBeenCalled();
  });

  it("restores defaults", () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);
    const resetBtn = screen.getByText("Restaurar Padrões");
    fireEvent.click(resetBtn);
    expect(mockSettings.restoreDefaults).toHaveBeenCalled();
  });

  it("updates sidebar position and tipi view mode", () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("◀ Esquerda"));
    fireEvent.click(screen.getByText("Direita ▶"));
    fireEvent.click(screen.getByText("📁 Família NCM"));
    fireEvent.click(screen.getByText("📖 Capítulo Completo"));

    expect(mockSettings.updateSidebarPosition).toHaveBeenCalledWith(
      SIDEBAR_POSITION.LEFT,
    );
    expect(mockSettings.updateSidebarPosition).toHaveBeenCalledWith(
      SIDEBAR_POSITION.RIGHT,
    );
    expect(mockSettings.updateTipiViewMode).toHaveBeenCalledWith(
      VIEW_MODE.FAMILY,
    );
    expect(mockSettings.updateTipiViewMode).toHaveBeenCalledWith(
      VIEW_MODE.CHAPTER,
    );
  });

  it("closes on ESC and backdrop click, but not when clicking inside content", () => {
    const onClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(globalThis, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(globalThis, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = screen.getByRole("button", {
      name: "Fechar configurações",
    });
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText("Tema"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("hides admin controls for non-admin users", () => {
    vi.mocked(useIsAdmin).mockReturnValue(false);
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.queryByTestId("admin-toggle")).not.toBeInTheDocument();
    expect(screen.queryByText("Modo Desenvolvedor")).not.toBeInTheDocument();
  });
});
