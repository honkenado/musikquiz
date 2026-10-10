import { createClient } from "@supabase/supabase-js";

// This is a publishable browser key. No service-role or database password is used here.
export const supabase = createClient(
  "https://nbjnpymtfdhwaweymwex.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5iam5weW10ZmRod2F3ZXltd2V4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1ODI2MDcsImV4cCI6MjEwNzE1ODYwN30.YDt3jEWuCtp_EOjve1EAzJ_X9oxfP3YkjKimCILADaw",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
