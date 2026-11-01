/* ==========================================================
   Zaytoon Restaurant — Supabase Auth for the admin panel (Step 8)
   ----------------------------------------------------------
   Real sign-in through Supabase Auth (no library needed — the
   same HTTPS endpoints that supabase-js uses):

     signIn()               → POST /auth/v1/token?grant_type=password
                              (= supabase.auth.signInWithPassword)
     getSession()           → current session, refreshed when needed
                              (= supabase.auth.getSession)
     signOut()              → POST /auth/v1/logout  (= supabase.auth.signOut)
     requestPasswordReset() → POST /auth/v1/recover (= resetPasswordForEmail)
     updatePassword()       → PUT  /auth/v1/user    (= updateUser({ password }))
     onAuthStateChange()    → SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED,
                              USER_UPDATED, PASSWORD_RECOVERY

   SECURITY
   • Supabase Auth checks the password and stores it (hashed) on
     its servers. This file never stores, logs or compares passwords.
   • The session lives in MEMORY ONLY — never localStorage,
     sessionStorage or cookies. Closing or reloading the admin
     page signs the admin out; that is deliberate.
   • Tokens are never logged and never handed to UI listeners.
   • Being signed in is NOT enough to manage data: isAdmin() asks
     the database, and Row Level Security enforces it on every request.
   ========================================================== */

'use strict';

globalThis.ZaytoonAuth = (() => {
  const data = () => globalThis.ZaytoonData;
  const REFRESH_EARLY_MS = 60 * 1000;    // refresh 1 minute before the token expires

  let session = null;       // { accessToken, refreshToken, expiresAt, user: { id, email } } — memory only
  let refreshTimer = null;
  const listeners = new Set();

  /* ---------- helpers ---------- */

  /** What listeners and the UI may see: user id + email, never tokens. */
  function publicSession() {
    return session ? { user: { ...session.user }, expiresAt: session.expiresAt } : null;
  }

  function emit(event, reason = null) {
    const snapshot = publicSession();
    listeners.forEach((callback) => {
      try { callback(event, snapshot, reason); } catch (error) { console.warn('[Zaytoon auth] listener failed'); }
    });
  }

  function storeSession(result, event) {
    session = {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: Date.now() + (Number(result.expires_in) || 3600) * 1000,
      user: { id: result.user.id, email: result.user.email }
    };
    scheduleRefresh();
    emit(event);
  }

  function clearSession(reason) {
    const hadSession = Boolean(session);
    session = null;
    clearTimeout(refreshTimer);
    if (hadSession) emit('SIGNED_OUT', reason);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!session) return;
    const wait = Math.max(5000, session.expiresAt - Date.now() - REFRESH_EARLY_MS);
    refreshTimer = setTimeout(() => { refreshSession().catch(() => { /* offline: retried when needed */ }); }, wait);
  }

  const isExpiring = () => !session || Date.now() >= session.expiresAt - REFRESH_EARLY_MS;

  /** Turns any error into a short, safe code (never the raw message). */
  function errorCode(error) {
    const code = error && error.code;
    if (['offline', 'network', 'timeout', 'not_configured', 'rate_limited'].includes(code)) return code;
    if (code === 'permission' || code === 'invalid' || code === 'session_expired' || (error && error.status === 400)) {
      return 'invalid_credentials';
    }
    return 'auth_failed';
  }

  /* ---------- session ---------- */

  async function refreshSession() {
    if (!session) return null;
    try {
      const result = await data().request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: session.refreshToken }
      });
      storeSession(result, 'TOKEN_REFRESHED');
      return publicSession();
    } catch (error) {
      if (['offline', 'network', 'timeout'].includes(error.code)) throw error;   // keep it; try again later
      clearSession('session_expired');                                          // refresh refused → session is over
      return null;
    }
  }

  /** Returns the current session (refreshing it if it is about to expire), or null. */
  async function getSession() {
    if (!session) return null;
    if (isExpiring()) {
      try {
        return await refreshSession();
      } catch (error) {
        // Offline: the session may still be valid for a little while
        return Date.now() < session.expiresAt ? publicSession() : null;
      }
    }
    return publicSession();
  }

  /** A valid access token for protected requests, or null if there is no valid session. */
  async function getAccessToken() {
    const current = await getSession();
    return current && session ? session.accessToken : null;
  }

  /* ---------- public API ---------- */

  async function signIn(email, password) {
    if (!data() || !data().isConfigured()) return { error: 'not_configured' };
    if (!navigator.onLine) return { error: 'offline' };
    try {
      const result = await data().request('/auth/v1/token?grant_type=password', {
        method: 'POST', body: { email: String(email).trim(), password: String(password) }
      });
      storeSession(result, 'SIGNED_IN');
      return { session: publicSession() };
    } catch (error) {
      return { error: errorCode(error) };
    }
  }

  /**
   * Asks the DATABASE whether the signed-in user is an admin (public.is_admin(),
   * which checks profiles.role for auth.uid()). This only decides what the UI
   * shows — Row Level Security enforces the same rule on every request.
   */
  async function isAdmin() {
    const token = await getAccessToken();
    if (!token) return false;
    const answer = await data().rpc('is_admin', {}, { accessToken: token });
    return answer === true;
  }

  async function signOut() {
    const token = session ? session.accessToken : null;
    clearSession('signed_out');     // the UI loses access immediately, even if the network call fails
    if (token && navigator.onLine) {
      try {
        await data().request('/auth/v1/logout', { method: 'POST', accessToken: token, raw: true });
      } catch (error) { /* token is already forgotten locally; it also expires on its own */ }
    }
  }

  /**
   * Sends a password-reset email. Always answers the same way, so it never
   * reveals whether an email address has an account.
   */
  async function requestPasswordReset(email, redirectTo) {
    if (!data() || !data().isConfigured()) return { error: 'not_configured' };
    if (!navigator.onLine) return { error: 'offline' };
    try {
      const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
      await data().request(`/auth/v1/recover${query}`, { method: 'POST', body: { email: String(email).trim() } });
    } catch (error) {
      if (['offline', 'network', 'timeout', 'rate_limited'].includes(error.code)) return { error: error.code };
      // any other answer (e.g. unknown email) is deliberately treated as "sent"
    }
    return { ok: true };
  }

  /**
   * Handles the link from the password-reset email (…/admin.html#access_token=…&type=recovery).
   * Removes the token from the address bar straight away.
   * Returns 'recovery' | 'invalid_link' | null (nothing to do).
   */
  async function consumeRecoveryLink() {
    const hash = location.hash.replace(/^#/, '');
    if (!/(^|&)(type=recovery|error=)/.test(hash)) return null;
    const params = new URLSearchParams(hash);
    history.replaceState(null, '', location.pathname + location.search);   // token leaves the URL

    if (params.get('error') || params.get('type') !== 'recovery' || !params.get('access_token')) return 'invalid_link';
    try {
      const user = await data().request('/auth/v1/user', { accessToken: params.get('access_token') });
      session = {
        accessToken: params.get('access_token'),
        refreshToken: params.get('refresh_token'),
        expiresAt: Date.now() + (Number(params.get('expires_in')) || 3600) * 1000,
        user: { id: user.id, email: user.email }
      };
      scheduleRefresh();
      emit('PASSWORD_RECOVERY');
      return 'recovery';
    } catch (error) {
      return 'invalid_link';
    }
  }

  async function updatePassword(newPassword) {
    const token = await getAccessToken();
    if (!token) return { error: 'session_expired' };
    try {
      const user = await data().request('/auth/v1/user', { method: 'PUT', body: { password: String(newPassword) }, accessToken: token });
      if (session) session.user = { id: user.id, email: user.email };
      emit('USER_UPDATED');
      return { ok: true };
    } catch (error) {
      if (['offline', 'network', 'timeout', 'rate_limited'].includes(error.code)) return { error: error.code };
      if (error.code === 'session_expired') return { error: 'session_expired' };
      return { error: 'weak_password' };   // Supabase rejects passwords that are too short / weak
    }
  }

  /** Subscribe to auth events. Returns an "unsubscribe" function. */
  function onAuthStateChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  // Timers can pause while the tab is hidden: re-check when it becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && session && isExpiring()) {
      refreshSession().catch(() => { /* offline */ });
    }
  });

  /** Forces a token refresh now (used when the server says the token expired). Returns true/false. */
  async function refreshNow() {
    try {
      return Boolean(await refreshSession());
    } catch (error) {
      return false;   // offline — the caller shows the offline message
    }
  }

  return Object.freeze({
    signIn, signOut, getSession, getAccessToken, refreshNow, isAdmin,
    requestPasswordReset, consumeRecoveryLink, updatePassword,
    onAuthStateChange,
    hasSession: () => Boolean(session)
  });
})();
