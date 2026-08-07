import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { LanguageSelector } from "../components/LanguageSelector";
import { LocaleProvider } from "../i18n/LocaleProvider";

test("renders all supported locales and switches the document language", async () => {
  const user = userEvent.setup();

  render(
    <LocaleProvider>
      <LanguageSelector />
    </LocaleProvider>,
  );

  const select = screen.getByRole("combobox", { name: "Choose language" });
  expect(select).toHaveValue("en");
  expect(screen.getByText("English", { selector: ".language-current" })).toBeInTheDocument();
  expect(screen.getAllByRole("option")).toHaveLength(4);
  expect(screen.getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual([
    "zh-CN",
    "en",
    "ja",
    "ko",
  ]);

  await user.selectOptions(select, "ja");

  expect(select).toHaveValue("ja");
  expect(screen.getByText("日本語", { selector: ".language-current" })).toBeInTheDocument();
  expect(document.documentElement.lang).toBe("ja");
});
