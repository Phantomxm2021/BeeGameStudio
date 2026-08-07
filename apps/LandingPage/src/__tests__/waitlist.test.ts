import { beforeEach, expect, test, vi } from "vitest";
import { submitWaitlist } from "../lib/waitlist";

const { from, insert } = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { from },
}));

beforeEach(() => {
  from.mockReturnValue({ insert });
  insert.mockReset();
});

test("normalizes the email before inserting a waitlist signup", async () => {
  insert.mockResolvedValue({ error: null });

  const result = await submitWaitlist({
    name: " Ada Lovelace ",
    email: " Ada@Example.COM ",
    persona: "creator",
    locale: "en",
    source: "landing-page",
  });

  expect(result).toEqual({ status: "success" });
  expect(from).toHaveBeenCalledWith("waitlist_signups");
  expect(insert).toHaveBeenCalledWith({
    name: "Ada Lovelace",
    email: "ada@example.com",
    persona: "creator",
    locale: "en",
    source: "landing-page",
  });
});

test("maps a unique constraint error to duplicate", async () => {
  insert.mockResolvedValue({ error: { code: "23505" } });

  await expect(
    submitWaitlist({
      name: "Ada",
      email: "ada@example.com",
      persona: "idea",
      locale: "en",
      source: "landing-page",
    }),
  ).resolves.toEqual({ status: "duplicate" });
});

test("maps other Supabase errors to error", async () => {
  insert.mockResolvedValue({ error: { code: "42P01" } });

  await expect(
    submitWaitlist({
      name: "Ada",
      email: "ada@example.com",
      persona: "idea",
      locale: "en",
      source: "landing-page",
    }),
  ).resolves.toEqual({ status: "error" });
});
