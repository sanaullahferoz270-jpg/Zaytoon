# Zaytoon Restaurant — Deployment Guide

Plain HTML/CSS/JavaScript. No build step. Upload the website files to any static host
that serves **HTTPS** (needed for offline mode and secure admin sign-in).

Do **not** upload the Android-app folders `android/`, `node_modules/`, `www/` and `scripts/`
(or `package.json`, `capacitor.config.json`). The Android app is described in `ANDROID.md`.

---

## 1. Supabase setup (manual — once)

1. Create a Supabase project.
2. **SQL Editor →** run `supabase-schema.sql`, then `supabase-security.sql` (both are safe to run again).
3. **Authentication → Users → Add user**: create the owner account (choose a strong password there — it is never stored in this project).
4. Make that user an admin (SQL Editor):
   ```sql
   update public.profiles set role = 'admin' where email = 'owner@example.com';
   ```
5. **Authentication → Providers → Email**: turn **off** "Allow new users to sign up".
6. **Authentication → URL Configuration**: Site URL = your HTTPS address; add `https://YOUR-DOMAIN/admin.html` to Redirect URLs (password-reset links).
7. **Authentication → SMTP**: set up your own email sender (the built-in one is rate-limited and for testing only), otherwise password-reset emails may not arrive.
8. **Project Settings → API**: copy the Project URL and the **anon / publishable** key into `supabase-config.js`.
   **Never** put the service-role/secret key, database password or JWT secret in any file.
9. **Storage**: the `menu-images` bucket is created by the SQL (public read, 5 MB, JPG/PNG/WebP). Uploads are admin-only by policy.

Verify: in an incognito window, the menu loads; signing in with a non-admin account shows "Unauthorized access."

## 2. Security headers (manual — host settings)

`_headers` is used automatically by **Netlify** and **Cloudflare Pages**.
**Before deploying, replace `YOUR-PROJECT-REF.supabase.co` in `_headers` (2 places) with your Project URL host.**
If you forget, the site still shows the bundled menu, but live data and admin sign-in are blocked by the browser.

For other hosts, send the same headers:

**Apache (`.htaccess`)**
```apache
Header set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://YOUR-PROJECT-REF.supabase.co; font-src 'self'; connect-src 'self' https://YOUR-PROJECT-REF.supabase.co; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"
Header set X-Content-Type-Options "nosniff"
Header set Referrer-Policy "strict-origin-when-cross-origin"
Header set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
Header set X-Frame-Options "DENY"
Header set Strict-Transport-Security "max-age=31536000; includeSubDomains"
<FilesMatch "^sw\.js$">
  Header set Cache-Control "no-cache"
</FilesMatch>
<FilesMatch "^(admin\.(html|js|css)|supabase-auth\.js)$">
  Header set Cache-Control "no-store"
</FilesMatch>
```

**Nginx**
```nginx
add_header Content-Security-Policy "…same value as above…" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
add_header X-Frame-Options "DENY" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
location = /sw.js { add_header Cache-Control "no-cache"; }
location ~ ^/(admin\.(html|js|css)|supabase-auth\.js)$ { add_header Cache-Control "no-store"; }
```

**Vercel (`vercel.json`)**
```json
{ "headers": [
  { "source": "/(.*)", "headers": [
    { "key": "Content-Security-Policy", "value": "…same value as above…" },
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
    { "key": "X-Frame-Options", "value": "DENY" } ] },
  { "source": "/sw.js", "headers": [ { "key": "Cache-Control", "value": "no-cache" } ] }
] }
```

Keep `manifest.json` served as `application/manifest+json` (or `application/json`).

## 3. Updating the app later

- Edit files and upload. Visitors get changed JS/CSS on their **second** visit (the first visit shows the cached copy and fetches the new one in the background).
- After changing `supabase-config.js`, `menu-data.js`, images or any big change: increase `CACHE_VERSION` in `sw.js` (e.g. `'v5'` → `'v6'`). Old caches are deleted automatically.
- If a new version fails to download (e.g. a missing file), the previous version keeps working.

## 4. Known trade-offs

- **Menu images (~6.7 MB, 20 photos up to 2480×3508)** are cached on first visit for offline use. That is a lot of mobile data in one go. Recommended (manual): export smaller copies (≈1200 px wide, ~150–250 KB) with the **same file names** and replace the files, then bump `CACHE_VERSION`. The project does not do this automatically, so the original photos are never altered.
- Admin sessions live in memory only: reloading the admin page signs out (deliberate).
- Admin changes need internet; nothing is queued offline.

## 5. Browser support

Chrome/Edge 90+, Firefox 98+, Safari / iOS 15.4+ (for `<dialog>` and `:focus-visible`), Samsung Internet 15+.
Automated tests ran in Chromium only — please check once on a real iPhone (Safari) and an Android phone after deploying.

## 6. Final checklist

- [ ] SQL files run; owner made admin; public sign-ups **off**
- [ ] `supabase-config.js` has URL + anon key only
- [ ] `_headers` (or host settings) updated with the real project host
- [ ] SMTP configured; Site URL + `admin.html` redirect URL set
- [ ] Site served over HTTPS
- [ ] Test: menu loads, call buttons dial, Facebook/TikTok links open, offline reload works
- [ ] Test: admin sign-in, edit an item, see it on the customer page, sign out
- [ ] If any secret key was ever pasted into a file or chat: **rotate it in Supabase**
