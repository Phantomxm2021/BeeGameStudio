import type { Locale } from "../i18n/types";
import { supabase } from "./supabase";

export type Persona = "idea" | "creator" | "investor";

export type WaitlistInput = {
  name: string;
  email: string;
  persona: Persona;
  locale: Locale;
  source: "landing-page";
};

export type WaitlistResult = {
  status: "success" | "duplicate" | "error";
};

export async function submitWaitlist(
  input: WaitlistInput,
): Promise<WaitlistResult> {
  if (!supabase) return { status: "error" };

  const payload = {
    ...input,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
  };

  try {
    const { error } = await supabase.from("waitlist_signups").insert(payload);
    if (!error) return { status: "success" };
    if (error.code === "23505") return { status: "duplicate" };
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}
