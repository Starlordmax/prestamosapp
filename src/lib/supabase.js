import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://wowogbyyxxbpnycveegg.supabase.co";

const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_51yHFKmQJXcye9JwIWBuKA_zNiI93XH";

export const supabase = createClient(supabaseUrl, supabaseKey);
