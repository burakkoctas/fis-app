import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    "Supabase env değişkenleri eksik: VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY tanımlı olmalı."
  );
}

export const supabase = createClient(url, anonKey);
