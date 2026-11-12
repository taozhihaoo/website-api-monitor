import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/api/client", async () => await import("./mocks/api-client"));
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { I18nProvider } from "../src/i18n/I18nContext";
import { en, translate, zh } from "../src/i18n/messages";
import { LanguageSwitch } from "../src/components/LanguageSwitch";
import { StatusBadge } from "../src/components/StatusBadge";
import { renderWithProviders } from "./test-utils";

beforeEach(() => {
  window.localStorage.clear();
});

describe("i18n dictionaries", () => {
  it("has a Chinese translation for every English key (and no extras)", () => {
    const enKeys = Object.keys(en);
    const missing = enKeys.filter((key) => !(key in zh));
    const extra = Object.keys(zh).filter((key) => !(key in en));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it("interpolates {placeholders}", () => {
    expect(translate("en", "monitors.subtitle", { count: 3 })).toBe("3 configured");
    expect(translate("zh", "monitors.subtitle", { count: 3 })).toBe("已配置 3 项");
    expect(translate("en", "action.manage")).toBe("Manage →");
  });

  it("falls back to English for unknown keys", () => {
    expect(translate("zh", "status.down")).toBe("故障");
    expect(translate("en", "status.down")).toBe("DOWN");
  });
});

describe("locale switching", () => {
  it("defaults to English when no preference is stored", () => {
    renderWithProviders(
      <I18nProvider>
        <StatusBadge status="up" />
        <StatusBadge status="down" />
      </I18nProvider>,
    );
    expect(screen.getByText("UP")).toBeInTheDocument();
    expect(screen.getByText("DOWN")).toBeInTheDocument();
  });

  it("switches to Chinese and persists the preference", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <I18nProvider>
        <LanguageSwitch />
        <StatusBadge status="up" />
      </I18nProvider>,
    );
    expect(screen.getByText("UP")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "简体中文" }));
    expect(screen.getByText("正常")).toBeInTheDocument();
    expect(screen.queryByText("UP")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("sitewatch_locale")).toBe("zh");
  });

  it("restores the saved Chinese preference", () => {
    window.localStorage.setItem("sitewatch_locale", "zh");
    renderWithProviders(
      <I18nProvider>
        <StatusBadge status="down" />
      </I18nProvider>,
    );
    expect(screen.getByText("故障")).toBeInTheDocument();
  });
});
