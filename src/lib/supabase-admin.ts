import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAdminKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

export function getSupabaseAdminClient() {
  if (!supabaseUrl || !supabaseAdminKey) {
    throw new Error(
      "Missing SUPABASE_URL and admin key. Set SUPABASE_SECRET_KEY (recommended) or SUPABASE_SERVICE_ROLE_KEY (legacy).",
    );
  }

  return createClient(supabaseUrl, supabaseAdminKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
