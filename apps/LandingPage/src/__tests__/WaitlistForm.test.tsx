import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { WaitlistForm } from "../components/WaitlistForm";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { submitWaitlist } from "../lib/waitlist";

vi.mock("../lib/waitlist", () => ({
  submitWaitlist: vi.fn(),
}));

const mockedSubmitWaitlist = vi.mocked(submitWaitlist);

function renderForm() {
  localStorage.clear();
  localStorage.setItem("bee-game-studio-locale", "zh-CN");
  return render(
    <LocaleProvider>
      <WaitlistForm />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedSubmitWaitlist.mockReset();
});

test("submits normalized data and keeps the name after success", async () => {
  mockedSubmitWaitlist.mockResolvedValue({ status: "success" });
  const user = userEvent.setup();
  renderForm();

  const name = screen.getByLabelText("怎么称呼你");
  await user.type(name, "Ada Lovelace");
  await user.type(screen.getByLabelText("你的邮箱"), " Ada@Example.COM ");
  await user.selectOptions(screen.getByRole("combobox"), "creator");
  await user.click(screen.getByRole("button", { name: "加入优先体验名单" }));

  expect(mockedSubmitWaitlist).toHaveBeenCalledWith({
    name: "Ada Lovelace",
    email: "ada@example.com",
    persona: "creator",
    locale: "zh-CN",
    source: "landing-page",
  });
  expect(await screen.findByRole("status")).toHaveTextContent("已经记下你的名字");
  expect(name).toHaveValue("Ada Lovelace");
});

test("uses native email validation before submitting", async () => {
  const user = userEvent.setup();
  renderForm();

  const email = screen.getByLabelText("你的邮箱");
  await user.type(email, "not-an-email");
  expect(email).toBeInvalid();
  await user.click(screen.getByRole("button", { name: "加入优先体验名单" }));

  expect(mockedSubmitWaitlist).not.toHaveBeenCalled();
});

test("rejects a whitespace-only name with a localized validation status", async () => {
  const user = userEvent.setup();
  renderForm();

  await user.type(screen.getByLabelText("怎么称呼你"), "   ");
  await user.type(screen.getByLabelText("你的邮箱"), "ada@example.com");
  await user.selectOptions(screen.getByRole("combobox"), "idea");
  await user.click(screen.getByRole("button", { name: "加入优先体验名单" }));

  expect(mockedSubmitWaitlist).not.toHaveBeenCalled();
  expect(await screen.findByRole("status")).toHaveTextContent("暂时无法提交，请稍后再试。");
  expect(screen.getByLabelText("怎么称呼你")).toBeInvalid();
});

test("shows a localized duplicate response", async () => {
  mockedSubmitWaitlist.mockResolvedValue({ status: "duplicate" });
  const user = userEvent.setup();
  renderForm();

  await user.type(screen.getByLabelText("怎么称呼你"), "Ada");
  await user.type(screen.getByLabelText("你的邮箱"), "ada@example.com");
  await user.selectOptions(screen.getByRole("combobox"), "idea");
  await user.click(screen.getByRole("button", { name: "加入优先体验名单" }));

  expect(await screen.findByRole("status")).toHaveTextContent("这个邮箱已经在优先体验名单中。");
});

test("shows a localized error response", async () => {
  mockedSubmitWaitlist.mockResolvedValue({ status: "error" });
  const user = userEvent.setup();
  renderForm();

  await user.type(screen.getByLabelText("怎么称呼你"), "Ada");
  await user.type(screen.getByLabelText("你的邮箱"), "ada@example.com");
  await user.selectOptions(screen.getByRole("combobox"), "idea");
  await user.click(screen.getByRole("button", { name: "加入优先体验名单" }));

  expect(await screen.findByRole("status")).toHaveTextContent("暂时无法提交，请稍后再试。");
});

test("confirms a successful signup with an accessible dialog", async () => {
  mockedSubmitWaitlist.mockResolvedValue({ status: "success" });
  const user = userEvent.setup();
  renderForm();

  await user.type(screen.getByLabelText("怎么称呼你"), "Ada");
  await user.type(screen.getByLabelText("你的邮箱"), "ada@example.com");
  await user.selectOptions(screen.getByRole("combobox"), "idea");
  await user.click(screen.getByRole("button", { name: "加入优先体验名单" }));

  expect(await screen.findByRole("dialog")).toHaveTextContent("已经加入优先体验名单");
  const close = screen.getByRole("button", { name: "关闭" });
  expect(close).toHaveFocus();

  await user.click(close);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("closes a failed signup dialog with Escape", async () => {
  mockedSubmitWaitlist.mockResolvedValue({ status: "error" });
  const user = userEvent.setup();
  renderForm();

  await user.type(screen.getByLabelText("怎么称呼你"), "Ada");
  await user.type(screen.getByLabelText("你的邮箱"), "ada@example.com");
  await user.selectOptions(screen.getByRole("combobox"), "idea");
  await user.click(screen.getByRole("button", { name: "加入优先体验名单" }));

  expect(await screen.findByRole("dialog")).toHaveTextContent("这次没有提交成功");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
