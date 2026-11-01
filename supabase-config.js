/* ==========================================================
   Zaytoon Restaurant — Supabase configuration (Step 7)
   ----------------------------------------------------------
   PUBLIC values only.

   Only the public client key belongs in frontend code.
   Never expose the Supabase service-role key.

   ✔ url      → Supabase Dashboard → Project Settings → API → Project URL
   ✔ anonKey  → the "anon" / "publishable" public key from the same page.
                It is DESIGNED to be public: it can only do what the
                Row Level Security policies in supabase-schema.sql allow
                (customers can read public data, nobody can write).

   ✘ NEVER put here (or anywhere in HTML / CSS / JS):
       service_role / secret key, database password, JWT secret.
       Those stay in the Supabase dashboard (or a server you control).

   Why a file and not environment variables?
   This is a static site (plain HTML/JS, no build step), so there
   is no server to inject environment variables. That is fine for
   the URL and anon key, because both are public by design.

   Leave both values empty to run fully on the local files
   (menu-data.js / restaurant-data.js) — the app works either way.
   ========================================================== */

'use strict';

globalThis.ZAYTOON_SUPABASE = Object.freeze({
  url: '',            // e.g. 'https://abcdefghijklmnop.supabase.co'
  anonKey: '',        // public anon / publishable key

  storageBucket: 'menu-images',
  requestTimeoutMs: 8000      // give up on a slow connection and use saved data
});
