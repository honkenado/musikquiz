import { createClient } from "@supabase/supabase-js";

// This is a publishable browser key. No service-role or database password is used here.
export const supabase = createClient(
  "https://nbjnpymtfdhwaweymwex.supabase.co",
  "sb_publishable_2xq3RouNlFQvYB8c23BnsA_joD_-WXU",
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);
