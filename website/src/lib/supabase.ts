import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON;
// Missing credentials should show the configuration screen, not crash at import.
export const supabase = url && key ? createClient(url, key) : null;
