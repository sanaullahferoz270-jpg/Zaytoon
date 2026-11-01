/* ==========================================================
   Zaytoon Restaurant — Android app helpers (Capacitor)
   ----------------------------------------------------------
   Runs ONLY inside the Android app. On the normal website
   (browser / PWA) it does nothing at all.

   Android back button, in this order:
     1. full-screen menu image open   → close it
     2. mobile navigation menu open    → close it
     3. "call" phone list open         → close it
     4. came here through a page link  → go back to where you were
     5. scrolled down the page         → back to the top
     6. otherwise                      → leave the app (normal Android
                                         behaviour; the app keeps its state)

   Links: tel: opens the phone dialer; Facebook, TikTok and WhatsApp
   open in their own apps / the browser (handled by Capacitor).
   WhatsApp stays a CONTACT option only.
   ========================================================== */

(function () {
  'use strict';

  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;

  document.documentElement.classList.add('native-app');

  const App = cap.Plugins && cap.Plugins.App;
  if (!App) return;

  const isViewerOpen = () => {
    const viewer = document.getElementById('viewer');
    return Boolean(viewer && !viewer.hidden);
  };
  const isNavOpen = () => document.body.classList.contains('nav-open');
  const isCallSheetOpen = () => {
    const sheet = document.getElementById('call-sheet');
    return Boolean(sheet && !sheet.hidden);
  };

  /** Re-uses the website's own "Escape" handling, so the app and website behave the same. */
  const pressEscape = () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  };

  App.addListener('backButton', (event) => {
    if (isViewerOpen() || isNavOpen() || isCallSheetOpen()) {
      pressEscape();
      return;
    }
    if (event && event.canGoBack) {
      window.history.back();
      return;
    }
    if (window.scrollY > 200) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    App.minimizeApp().catch(() => App.exitApp());
  });
})();
