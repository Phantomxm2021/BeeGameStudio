import { expect, test, vi } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: null }));

test("returns an error when Supabase is not configured", async () => {
  const { submitWaitlist } = await import("../lib/waitlist");

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
