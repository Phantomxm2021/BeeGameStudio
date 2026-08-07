import { createClient } from "@supabase/supabase-js";

type ViteEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

const env = (import.meta as ImportMeta & { env?: ViteEnv }).env ?? {};
const url = env.VITE_SUPABASE_URL?.trim();
const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabase =
  url && anonKey ? createClient(url, anonKey) : null;
