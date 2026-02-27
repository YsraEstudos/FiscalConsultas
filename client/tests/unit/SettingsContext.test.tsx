import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULTS,
  SIDEBAR_POSITION,
  STORAGE_KEYS,
  VIEW_MODE,
  ACCENT_COLOR,
} from "../../src/constants";
import {
  SettingsProvider,
  useSettings,
} from "../../src/context/SettingsContext";

function SettingsProbe() {
  const settings = useSettings();
  return (
    <div>
      <div data-testid="theme">{settings.theme}</div>
      <div data-testid="accent">{settings.accentColor}</div>
      <div data-testid="font">{settings.fontSize}</div>
      <div data-testid="highlight">{String(settings.highlightEnabled)}</div>
      <div data-testid="admin">{String(settings.adminMode)}</div>
      <div data-testid="tipi">{settings.tipiViewMode}</div>
      <div data-testid="sidebar">{settings.sidebarPosition}</div>

      <button onClick={() => settings.updateTheme("light")}>theme-light</button>
      <button onClick={() => settings.updateAccentColor(ACCENT_COLOR.PINK)}>
        accent-pink
      </button>
      <button onClick={() => settings.updateFontSize(20)}>font-20</button>
      <button onClick={() => settings.toggleHighlight()}>
        toggle-highlight
      </button>
      <button onClick={() => settings.toggleAdminMode()}>toggle-admin</button>
      <button onClick={() => settings.updateTipiViewMode(VIEW_MODE.FAMILY)}>
        tipi-family
      </button>
      <button
        onClick={() => settings.updateSidebarPosition(SIDEBAR_POSITION.RIGHT)}
      >
        sidebar-right
      </button>
      <button onClick={() => settings.restoreDefaults()}>
        restore-defaults
      </button>
    </div>
  );
}

describe("SettingsContext", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.className = "";
    delete document.documentElement.dataset.theme;
    document.documentElement.style.fontSize = "";
  });

  it("throws when useSettings is called outside provider", () => {
    const OutsideConsumer = () => {
      useSettings();
      return null;
    };

    expect(() => render(<OutsideConsumer />)).toThrow(
      "useSettings must be used within a SettingsProvider",
    );
  });

  it("loads persisted settings and applies highlight disabled classes", async () => {
    localStorage.setItem(STORAGE_KEYS.THEME, "light");
    localStorage.setItem(STORAGE_KEYS.ACCENT_COLOR, ACCENT_COLOR.GREEN);
    localStorage.setItem(STORAGE_KEYS.FONT_SIZE, "18");
    localStorage.setItem(STORAGE_KEYS.HIGHLIGHT, "false");
    localStorage.setItem(STORAGE_KEYS.ADMIN_MODE, "false");
    localStorage.setItem(STORAGE_KEYS.TIPI_VIEW_MODE, VIEW_MODE.FAMILY);
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_POSITION, SIDEBAR_POSITION.RIGHT);

    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("theme")).toHaveTextContent("light"),
    );
    expect(screen.getByTestId("accent")).toHaveTextContent(ACCENT_COLOR.GREEN);
    expect(screen.getByTestId("font")).toHaveTextContent("18");
    expect(screen.getByTestId("highlight")).toHaveTextContent("false");
    expect(screen.getByTestId("admin")).toHaveTextContent("false");
    expect(screen.getByTestId("tipi")).toHaveTextContent(VIEW_MODE.FAMILY);
    expect(screen.getByTestId("sidebar")).toHaveTextContent(
      SIDEBAR_POSITION.RIGHT,
    );

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.fontSize).toBe("18px");
    expect(document.body.classList.contains("disable-unit-highlights")).toBe(
      true,
    );
    expect(
      document.body.classList.contains("disable-exclusion-highlights"),
    ).toBe(true);
    expect(document.body.classList.contains("disable-smart-links")).toBe(true);
  });

  it("falls back to defaults for invalid persisted values and missing admin flag", async () => {
    localStorage.setItem(STORAGE_KEYS.TIPI_VIEW_MODE, "invalid-value");
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_POSITION, "invalid-side");
    localStorage.setItem(STORAGE_KEYS.ACCENT_COLOR, "invalid-color");

    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("admin")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("tipi")).toHaveTextContent(
      DEFAULTS.TIPI_VIEW_MODE,
    );
    expect(screen.getByTestId("sidebar")).toHaveTextContent(
      DEFAULTS.SIDEBAR_POSITION,
    );
    expect(screen.getByTestId("accent")).toHaveTextContent(
      DEFAULTS.ACCENT_COLOR,
    );
  });

  it("updates values and restores defaults", async () => {
    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    );

    fireEvent.click(screen.getByText("theme-light"));
    fireEvent.click(screen.getByText("accent-pink"));
    fireEvent.click(screen.getByText("font-20"));
    fireEvent.click(screen.getByText("toggle-highlight"));
    fireEvent.click(screen.getByText("toggle-admin"));
    fireEvent.click(screen.getByText("tipi-family"));
    fireEvent.click(screen.getByText("sidebar-right"));

    await waitFor(() =>
      expect(screen.getByTestId("theme")).toHaveTextContent("light"),
    );
    expect(screen.getByTestId("accent")).toHaveTextContent(ACCENT_COLOR.PINK);
    expect(screen.getByTestId("font")).toHaveTextContent("20");
    expect(screen.getByTestId("highlight")).toHaveTextContent("false");
    expect(screen.getByTestId("admin")).toHaveTextContent("false");
    expect(screen.getByTestId("tipi")).toHaveTextContent(VIEW_MODE.FAMILY);
    expect(screen.getByTestId("sidebar")).toHaveTextContent(
      SIDEBAR_POSITION.RIGHT,
    );
    expect(document.body.classList.contains("disable-unit-highlights")).toBe(
      true,
    );

    fireEvent.click(screen.getByText("restore-defaults"));

    await waitFor(() =>
      expect(screen.getByTestId("theme")).toHaveTextContent(DEFAULTS.THEME),
    );
    expect(screen.getByTestId("accent")).toHaveTextContent(
      DEFAULTS.ACCENT_COLOR,
    );
    expect(screen.getByTestId("font")).toHaveTextContent(
      String(DEFAULTS.FONT_SIZE),
    );
    expect(screen.getByTestId("highlight")).toHaveTextContent(
      String(DEFAULTS.HIGHLIGHT),
    );
    expect(screen.getByTestId("admin")).toHaveTextContent(
      String(DEFAULTS.ADMIN_MODE),
    );
    expect(screen.getByTestId("tipi")).toHaveTextContent(
      DEFAULTS.TIPI_VIEW_MODE,
    );
    expect(screen.getByTestId("sidebar")).toHaveTextContent(
      DEFAULTS.SIDEBAR_POSITION,
    );
    expect(document.body.classList.contains("disable-unit-highlights")).toBe(
      false,
    );
  });

  it("logs and keeps defaults when storage access throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("boom");
      });

    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("theme")).toHaveTextContent(DEFAULTS.THEME),
    );
    expect(errSpy).toHaveBeenCalled();

    getItemSpy.mockRestore();
    errSpy.mockRestore();
  });
});
