# Zaytoon Restaurant — Android App

The Android app is the **existing customer website** packaged with **Capacitor 8**.
It is not a second website: `scripts/build-web.mjs` copies the customer files into `www/`,
and Capacitor puts `www/` inside the app.

| | |
|---|---|
| App name | Zaytoon Restaurant |
| App ID (package) | `com.zaytoonrestaurant.kandahar` — **never change it after the first Play Store upload** |
| Version | 1.0.0 (version code 1) — set in `android/variables.gradle` |
| Min / target Android | Android 7.0 (API 24) / Android 16 (API 36) |
| Orientation | Portrait |

## What is (and is not) inside the app

Included: `index.html`, `style.css`, `script.js`, `boot.js`, `native-app.js`, the data files,
`supabase-config.js` + `supabase-data.js` (public anon key only), `img/`, `logo/`, `assets/`, `manifest.json`.

**Not included:** the admin panel (`admin.*`, `supabase-auth.js`), the SQL files, `sw.js`,
`_headers` and the documents. The admin panel stays on the website only.
The build script stops with an error if `supabase-config.js` looks like it contains a secret key.

## 1. Install once (on your computer)

1. **Node.js 22 or newer** — https://nodejs.org (LTS)
2. **Android Studio** (Otter 2025.2.1 or newer) — https://developer.android.com/studio
   It includes Java (JDK 21), Gradle and the Android SDK. In Android Studio's
   *SDK Manager* install **Android SDK Platform 36** and **Android SDK Build-Tools**.

## 2. Open the project

In this project folder (Command Prompt / Terminal):

```
npm install
npx cap sync
npx cap open android
```

`npm install` also prepares `www/`. Run `npx cap sync` again **every time you change the website files**
(menu data, images, texts, Supabase config) so the app gets the new version.

The first time Android Studio opens, wait until "Gradle sync" finishes (it downloads the Android build tools).

## 3. Test build (APK)

Android Studio: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**
→ `android/app/build/outputs/apk/debug/app-debug.apk` (install it on a phone to test).
Or press **Run ▶** with a phone connected (USB debugging on) or an emulator.

Command line alternative: `cd android` then `gradlew assembleDebug` (Windows) / `./gradlew assembleDebug`.

## 4. Release build for Google Play (AAB)

Android Studio: **Build → Generate Signed App Bundle or APK → Android App Bundle**
→ *Create new…* key store (first time) → choose **release** → Finish
→ `android/app/release/app-release.aab`.

**Keep the key store file and its passwords safe and backed up.** Every future update must be
signed with the same key. Never put the key store or its passwords in the website, in chat, or online.

Optional (command line signing): create `android/keystore.properties` (it is ignored, never shared):
```
storeFile=../zaytoon-release.jks
storePassword=…
keyAlias=zaytoon
keyPassword=…
```
then `cd android` and `gradlew bundleRelease` → `android/app/build/outputs/bundle/release/app-release.aab`.

## 5. Next version

In `android/variables.gradle` raise **`appVersionCode`** by 1 (2, 3, …) and set **`appVersionName`**
(e.g. `1.0.1`). Then `npx cap sync` and build again.

## How the app behaves

- **Back button:** closes the full-screen menu image → closes the menu → closes the call list →
  goes back to the previous section → scrolls to the top → leaves the app.
- **Links:** phone numbers open the dialer; Facebook, TikTok and WhatsApp open in their apps or the browser.
  WhatsApp is a contact option only.
- **Offline:** all pages, menu images and restaurant info are inside the app, so it works without internet.
  With internet (and Supabase configured) it loads the latest data and keeps a saved copy.
  The website's service worker is not used inside the app — it is not needed there.
- **Status bar:** light icons over the black Zaytoon background (edge-to-edge, using the website's safe-area spacing).
- **Splash screen:** Zaytoon logo on black for about a second, then fades into the app.

## Icons

Launcher icons and splash images in `android/app/src/main/res/` were made from the existing logo
(`logo/`, unchanged). `android/app/src/main/ic_launcher-playstore.png` (512×512) is the Play Store icon.
If you get a higher-quality or transparent master logo, recreate them in Android Studio:
right-click `res` → **New → Image Asset**.
