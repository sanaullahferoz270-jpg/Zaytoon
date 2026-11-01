/* ==========================================================
   Zaytoon Restaurant — Admin Panel (Step 8: Supabase Auth + admin role)
   ----------------------------------------------------------
   SECURITY — READ FIRST
   • Frontend route hiding is not security. Supabase Auth +
     database Row Level Security will provide real
     authorization in the next backend phase.
   • This file contains NO passwords, NO admin secrets and
     NO API keys. Never add them here.
   • Anything in the browser (JavaScript checks, hidden pages,
     localStorage, cookies) can be changed by the user. The
     database must decide who may read/write — not this file.

   Flow:
     Admin login → Supabase Auth → session → admin role check (is_admin)
       → Row Level Security → database + storage → dashboard

   Layers in this file:
     1. Config & helpers
     2. AuthService   (wraps supabase-auth.js)
     3. Session       (what the screen shows — grants nothing)
     4. DataService   (wraps supabase-data.js)
     5. UI: login, navigation, overview, menu, forms, notice,
        settings, dialogs, toasts
     6. Start-up
   ========================================================== */

'use strict';


/* ---------- 1. Config & helpers ---------- */

const CONFIG = {
  // Supabase URL + PUBLIC anon key live in supabase-config.js (shared with the
  // customer app). NEVER put the "service_role" key in frontend code.

  // Developer convenience, NOT security: the "local preview" button is only
  // offered on this computer (file:// or localhost) AND only while Supabase is
  // not configured. It shows public data only and can never write to Supabase.
  allowLocalPreview: (() => {
    const host = location.hostname;
    return location.protocol === 'file:'
      || host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
      || host.endsWith('.localhost');
  })()
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** Deep copy of plain data (the bundled data objects are frozen). */
function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatPrice(price) {
  return price == null || price === '' ? 'On menu image' : `${Number(price).toLocaleString('en-US')} Afs`;
}

/** "+93 700…" → "+93700…" (removes spaces, dashes and brackets). */
function normalisePhone(value) {
  return String(value || '').replace(/[\s\-()]/g, '');
}
function isValidPhone(value) {
  return /^\+\d{9,15}$/.test(normalisePhone(value));
}

/** Valid https URL, optionally on one of the allowed domains. */
function isValidHttpsUrl(value, allowedDomains = null) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (!allowedDomains) return true;
    const host = url.hostname.toLowerCase();
    return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch (error) {
    return false;
  }
}

/** Friendly messages — the owner never sees technical errors. */
const MESSAGES = {
  // sign-in
  invalid_credentials: 'Invalid email or password.',
  unauthorized: 'Unauthorized access.',
  session_expired: 'Your session has expired. Please sign in again.',
  not_configured: 'Sign-in is not available yet: Supabase is not configured for this site.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  network: 'The server could not be reached. Please check the connection and try again.',
  auth_failed: 'Sign-in is not available right now. Please try again later.',
  // password reset
  reset_sent: 'If the account exists, a password reset email will be sent.',
  invalid_link: 'This password reset link is invalid or has expired. Please request a new one.',
  password_updated: 'Your password has been changed. Please sign in with your new password.',
  weak_password: 'This password was not accepted. Please choose a longer, stronger password.',
  // data
  offline: 'Internet connection is required to manage restaurant data.',
  write_blocked: 'You do not have permission to make this change.',
  upload_unavailable: 'Uploading images requires an admin sign-in (not available in preview mode). Please choose an existing image.',
  category_not_empty: 'This category still has menu items. Move or delete those items first.',
  conflict: 'This conflicts with existing data (for example, a duplicate). Please check and try again.',
  invalid_data: 'The database did not accept these values. Please check the form.',
  timeout: 'The connection is too slow right now. Please try again.',
  save_failed: 'Your changes could not be saved. Please try again.',
  load_failed: 'Restaurant data could not be loaded. Please refresh the page.'
};

class AdminError extends Error {
  constructor(code, message = null) {
    super(message || MESSAGES[code] || MESSAGES.save_failed);
    this.code = code;
  }

  /** Converts a data-service error into a friendly message (technical details go to the console only). */
  static from(error) {
    if (error instanceof AdminError) return error;
    console.warn('[Zaytoon admin] request failed:', error && error.code);   // code only — no tokens, no raw details
    const map = {
      permission: 'write_blocked', offline: 'offline', network: 'offline', timeout: 'timeout',
      conflict: 'conflict', invalid: 'invalid_data', not_configured: 'not_configured',
      category_not_empty: 'category_not_empty', session_expired: 'session_expired', rate_limited: 'rate_limited'
    };
    if (error && error.code === 'bad_image') {
      const reasons = {
        type: 'Please choose a JPG, PNG or WebP image.',
        not_an_image: 'This file is not a real JPG, PNG or WebP image.',
        too_large: 'The image is too large. Please choose a photo under 15 MB.',
        empty: 'The chosen file is empty.',
        unreadable: 'This image could not be read. Please try another file.'
      };
      return new AdminError('bad_image', reasons[error.detail && error.detail.reason] || reasons.unreadable);
    }
    return new AdminError(map[error && error.code] || 'save_failed');
  }
}

const hasSupabase = () => Boolean(window.ZaytoonData && window.ZaytoonData.isConfigured());


/* ---------- 2. AuthService ----------
   Thin wrapper around supabase-auth.js (real Supabase Auth).
   Flow:  sign in → Supabase Auth session → is_admin() asked to the
          DATABASE → dashboard. Row Level Security re-checks the admin
          role on every request, so this file is only the "front door". */
const auth = () => window.ZaytoonAuth;

const AuthService = {
  signIn: (email, password) => (auth() ? auth().signIn(email, password) : Promise.resolve({ error: 'not_configured' })),
  getSession: () => (auth() ? auth().getSession() : Promise.resolve(null)),
  getAccessToken: () => (auth() ? auth().getAccessToken() : Promise.resolve(null)),
  refreshNow: () => (auth() ? auth().refreshNow() : Promise.resolve(false)),
  async isAdmin() {
    try {
      return auth() ? await auth().isAdmin() : false;
    } catch (error) {
      throw AdminError.from(error);
    }
  },
  signOut: () => (auth() ? auth().signOut() : Promise.resolve()),
  onAuthStateChange: (callback) => (auth() ? auth().onAuthStateChange(callback) : () => {})
};


/* ---------- 3. Session (UI state, in memory only) ----------
   The real session (tokens) lives inside supabase-auth.js, in memory.
   These flags only decide what the screen shows — they grant nothing. */
const Session = {
  user: null,        // { id, email } from Supabase Auth
  isAdmin: false,    // result of the database's is_admin() check (UI only)
  preview: false,    // local developer preview (not signed in, local only)

  canEdit() {
    return (Boolean(this.user) && this.isAdmin) || this.preview;
  },
  clear() {
    this.user = null;
    this.isAdmin = false;
    this.preview = false;
  }
};


/* ---------- 4. DataService ----------
   UI  →  DataService  →  ZaytoonData (supabase-data.js)  →  Supabase
                       →  local files, if Supabase is not configured / unreachable

   READS: the same public data customers see (Supabase if available,
   otherwise menu-data.js / restaurant-data.js).

   WRITES:
   • Signed-in admin: sent to Supabase with the admin's session token.
     Row Level Security (supabase-security.sql) decides; a refused write
     is shown as a friendly message, never as a success.
   • Local preview (only when Supabase is NOT configured, not signed in):
     kept in this browser only.
     TEMPORARY ONLY — not secure storage, never published to customers,
     and it only ever holds public restaurant content. */

const TempStore = {
  prefix: 'zaytoon:admin-preview:',   // TEMPORARY ONLY

  read(key) {
    try {
      const raw = localStorage.getItem(this.prefix + key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  },
  write(key, value) {
    localStorage.setItem(this.prefix + key, JSON.stringify(value));   // may throw (storage full)
  },
  clearAll() {
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith(this.prefix))
        .forEach((key) => localStorage.removeItem(key));
    } catch (error) { /* storage blocked: nothing to clear */ }
  }
};

/** Data that ships with the app (the same files the customer app uses). */
function bundledInfo() {
  if (!window.ZAYTOON_INFO) throw new AdminError('load_failed');
  return clone(window.ZAYTOON_INFO);
}
function bundledMenu() {
  if (!window.ZAYTOON_MENU) throw new AdminError('load_failed');
  return clone(window.ZAYTOON_MENU);
}

/** Builds the full Pashto notice text from its parts (same order as the customer app). */
function composeNotice(info) {
  const n = info.notice || {};
  return [
    n.greeting, '',
    n.warning, '',
    n.instruction, '',
    ...info.phones.map((phone) => `📞 ${phone.number}`), '',
    `🚚 ${info.deliveryText.ps}`, '',
    `📍 ${n.addressLabel} ${info.address.ps}`, '',
    n.thanks
  ].join('\n');
}

/** Image address for display (local file or Supabase public URL). */
function imageUrlFor(path) {
  if (!path) return '';
  if (hasSupabase()) return window.ZaytoonData.getImageUrl(path);
  return path.startsWith('img/') ? path : '';
}

/** "Kabab Rolls" → "kabab-rolls" (Pashto-only names get a random id). */
function makeSlug(text) {
  const slug = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return `${slug || 'item'}-${Date.now().toString(36)}`;
}

const DataService = {
  source: 'local',        // 'supabase' when the data on screen came from Supabase
  connection: 'not_configured',   // 'connected' | 'unreachable' | 'not_configured'
  lastSaved: null,
  base: null,             // { info, menu } — Supabase or local files

  get isPreview() { return Session.preview; },

  /** Loads the public data (Supabase first, local files as fallback). */
  async loadBase() {
    const local = { info: bundledInfo(), menu: bundledMenu() };
    if (hasSupabase()) {
      if (!navigator.onLine) {
        this.connection = 'unreachable';
      } else {
        try {
          // Signed-in admins read with their own token, so RLS also returns hidden items/categories
          this.base = Session.preview || !Session.user
            ? await window.ZaytoonData.loadPublicData(local)
            : await this.withFreshToken((accessToken) => window.ZaytoonData.loadPublicData(local, { accessToken }));
          this.source = 'supabase';
          this.connection = 'connected';
          return;
        } catch (error) {
          if (error.code === 'session_expired') throw new AdminError('session_expired');
          console.warn('[Zaytoon admin] Supabase unavailable, showing local data:', error && error.code);
          this.connection = 'unreachable';
        }
      }
    } else {
      this.connection = 'not_configured';
    }
    this.base = local;
    this.source = 'local';
  },

  /**
   * Runs task(accessToken) with a valid session token. If the server answers
   * "token expired", the token is refreshed ONCE and the task retried; if that
   * fails too, the session is over → sign out (no further protected requests).
   */
  async withFreshToken(task) {
    let accessToken = await AuthService.getAccessToken();
    if (!accessToken) {
      handleSessionExpired();
      throw new AdminError('session_expired');
    }
    try {
      return await task(accessToken);
    } catch (error) {
      if (!error || error.code !== 'session_expired') throw error;
      accessToken = (await AuthService.refreshNow()) ? await AuthService.getAccessToken() : null;
      if (!accessToken) {
        handleSessionExpired();
        throw new AdminError('session_expired');
      }
      return task(accessToken);   // a second "expired" is handled by the caller
    }
  },

  /** Signed-in write to Supabase. RLS in the database is what allows or refuses it. */
  async remote(task) {
    if (!Session.canEdit()) throw new AdminError('unauthorized');
    if (!hasSupabase()) throw new AdminError('not_configured');
    if (!navigator.onLine) throw new AdminError('offline');      // nothing is queued offline
    try {
      const result = await this.withFreshToken((accessToken) => task({ accessToken }));
      this.lastSaved = new Date();
      await this.loadBase();       // show exactly what the database now holds
      return result;
    } catch (error) {
      const friendly = AdminError.from(error);
      if (friendly.code === 'session_expired') handleSessionExpired();
      throw friendly;
    }
  },

  /** Preview write (this browser only). TEMPORARY ONLY. */
  async local(key, value) {
    if (!Session.canEdit()) throw new AdminError('unauthorized');
    try {
      TempStore.write(key, value);
      this.lastSaved = new Date();
    } catch (error) {
      throw new AdminError('save_failed');
    }
  },

  // ===== Restaurant information =====
  async loadRestaurantData() {
    return (this.isPreview && TempStore.read('restaurant')) || clone(this.base.info);
  },

  async saveRestaurantData(changes) {
    if (this.isPreview) {
      const updated = { ...(await this.loadRestaurantData()), ...changes };
      await this.local('restaurant', updated);
      return updated;
    }
    const row = {};
    if ('name' in changes) row.restaurant_name = changes.name;
    if ('namePs' in changes) row.restaurant_name_ps = changes.namePs || null;
    if (changes.address) {
      row.address = changes.address.ps;
      row.address_en = changes.address.en || null;
      row.map_url = changes.address.mapUrl || null;
    }
    if ('deliveryActive' in changes) row.delivery_active = changes.deliveryActive;
    if (changes.deliveryText) { row.delivery_text_ps = changes.deliveryText.ps; row.delivery_text_en = changes.deliveryText.en; }
    await this.remote((opts) => window.ZaytoonData.updateRestaurantSettings(row, opts));
    return this.loadRestaurantData();
  },

  // ===== Contact: phones + WhatsApp Contact =====
  async saveContactData({ phones, whatsapp }) {
    if (this.isPreview) return this.saveRestaurantData({ phones, whatsapp });
    await this.remote(async (opts) => {
      await window.ZaytoonData.updateRestaurantPhones(phones, opts);
      await window.ZaytoonData.updateRestaurantSettings({ whatsapp_number: whatsapp.number }, opts);
    });
    return this.loadRestaurantData();
  },

  // ===== Social links =====
  async saveSocialData(social) {
    if (this.isPreview) return this.saveRestaurantData({ social });
    const url = (id) => (social.find((link) => link.id === id) || {}).url || null;
    await this.remote((opts) => window.ZaytoonData.updateSocialLinks(
      { facebook_url: url('facebook'), tiktok_url: url('tiktok') }, opts));
    return this.loadRestaurantData();
  },

  // ===== Notice =====
  async loadNoticeData() {
    const info = await this.loadRestaurantData();
    return (info.notice && info.notice.text) || composeNotice(info);
  },
  async saveNoticeData(text) {
    if (this.isPreview) {
      const info = await this.loadRestaurantData();
      return this.saveRestaurantData({ notice: { ...info.notice, text } });
    }
    await this.remote((opts) => window.ZaytoonData.updateRestaurantNotice(text, opts));
    return this.loadRestaurantData();
  },

  // ===== Menu =====
  async loadMenuData() {
    const menu = (this.isPreview && TempStore.read('menu')) || clone(this.base.menu);
    menu.categories = menu.categories.map((c) => ({ description: '', active: true, ...c }));
    menu.items = menu.items.map((item) => ({
      description: '', price: null, active: true, ...item,
      imagePath: item.imagePath || (item.image && item.image.startsWith('img/') ? item.image : null)
    }));
    return menu;
  },

  /** Database row from the admin form values. */
  itemRow(data, menu) {
    const category = menu.categories.find((c) => c.id === data.category);
    return {
      category_id: category && category.dbId,
      name: data.title,
      name_ps: data.titlePs || null,
      description: data.description || null,
      price: data.price,
      image_path: data.imagePath || null,
      image_width: data.width || null,
      image_height: data.height || null,
      is_available: data.active,
      sort_order: data.order
    };
  },

  async createMenuItem(data, menu) {
    if (this.isPreview) {
      const item = { id: makeSlug(data.title), ...data, image: imageUrlFor(data.imagePath) || null };
      menu.items.push(item);
      await this.local('menu', menu);
      return item.id;
    }
    const row = await this.remote((opts) => window.ZaytoonData.createMenuItem(
      { slug: makeSlug(data.title), ...this.itemRow(data, menu) }, opts));
    return row.slug || row.id;
  },

  async updateMenuItem(item, data, menu) {
    if (this.isPreview) {
      Object.assign(item, data, { image: imageUrlFor(data.imagePath) || null });
      await this.local('menu', menu);
      return item.id;
    }
    await this.remote((opts) => window.ZaytoonData.updateMenuItem(item.dbId, this.itemRow(data, menu), opts));
    return item.id;
  },

  async deleteMenuItem(item, menu) {
    if (this.isPreview) {
      menu.items = menu.items.filter((entry) => entry.id !== item.id);
      await this.local('menu', menu);
      return;
    }
    // Deletes the row, then only an UPLOADED image (never files in img/)
    await this.remote((opts) => window.ZaytoonData.deleteMenuItem(item.dbId, opts));
  },

  // ===== Categories =====
  categoryRow(data) {
    return { name: data.label, name_ps: data.labelPs || null, description: data.description || null,
      sort_order: data.order, is_active: data.active };
  },

  async createCategory(data, menu) {
    if (this.isPreview) {
      menu.categories.push({ id: makeSlug(data.label), ...data });
      await this.local('menu', menu);
      return;
    }
    await this.remote((opts) => window.ZaytoonData.createMenuCategory(
      { slug: makeSlug(data.label), ...this.categoryRow(data) }, opts));
  },

  async updateCategory(category, data, menu) {
    if (this.isPreview) {
      Object.assign(category, data);
      await this.local('menu', menu);
      return;
    }
    await this.remote((opts) => window.ZaytoonData.updateMenuCategory(category.dbId, this.categoryRow(data), opts));
  },

  /** Never deletes a category that still has items (the database refuses too). */
  async deleteCategory(category, menu) {
    if (menu.items.some((item) => item.category === category.id)) throw new AdminError('category_not_empty');
    if (this.isPreview) {
      menu.categories = menu.categories.filter((c) => c.id !== category.id);
      await this.local('menu', menu);
      return;
    }
    await this.remote((opts) => window.ZaytoonData.deleteMenuCategory(category.dbId, opts));
  },

  // ===== Images =====
  /** Checks the file (type, real content, size), then uploads it — only for signed-in admins. */
  async uploadImage(file) {
    try {
      if (window.ZaytoonData) await window.ZaytoonData.validateImageFile(file);
    } catch (error) {
      throw AdminError.from(error);
    }
    if (this.isPreview || !hasSupabase() || !Session.user) throw new AdminError('upload_unavailable');
    if (!navigator.onLine) throw new AdminError('offline');
    try {
      return await this.withFreshToken((accessToken) => window.ZaytoonData.uploadMenuImage(file, { accessToken }));
    } catch (error) {
      const friendly = AdminError.from(error);
      if (friendly.code === 'session_expired') handleSessionExpired();
      throw friendly;
    }
  },

  /** Removes an uploaded image that is no longer used (local img/ files are never touched). */
  async discardUploadedImage(path) {
    if (!path || !hasSupabase() || !window.ZaytoonData.isStoragePath(path)) return;
    try {
      if (!(await AuthService.getAccessToken())) return;
      await this.withFreshToken((accessToken) => window.ZaytoonData.deleteMenuImage(path, { accessToken }));
    } catch (error) {
      console.warn('[Zaytoon admin] Unused image could not be removed:', path, error && error.code);
    }
  },

  // ===== Preview helpers =====
  hasPreviewChanges() {
    return Boolean(TempStore.read('restaurant') || TempStore.read('menu'));
  },
  resetPreview() {
    TempStore.clearAll();
    this.lastSaved = null;
  },
  async exportPreview() {
    return {
      exportedAt: new Date().toISOString(),
      note: 'Zaytoon admin PREVIEW data (not published). Public restaurant content only.',
      restaurant: await this.loadRestaurantData(),
      menu: await this.loadMenuData()
    };
  }
};


/* ---------- 5. UI ---------- */

const state = {
  info: null,
  menu: null,
  originalImages: [],     // images that ship with the app (never renamed or deleted)
  dirtyForms: new Set(),
  menuQuery: '',
  menuCategory: 'all'
};

/* ----- Toasts ----- */
function toast(message, type = 'success') {
  const box = $('#toasts');
  const item = document.createElement('div');
  item.className = `toast ${type === 'error' ? 'toast--error' : ''}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  item.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${type === 'error' ? 'a-info' : 'a-check'}"/></svg>
    <span>${escapeHtml(message)}</span>`;
  box.appendChild(item);
  setTimeout(() => item.remove(), 3600);
}

/* ----- Confirmation dialog (returns true / false) ----- */
function confirmAction({ title, text, okLabel = 'Delete', cancelLabel = 'Cancel', danger = true }) {
  const dialog = $('#confirm-dialog');
  const ok = $('#confirm-ok');
  const cancel = $('#confirm-cancel');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  ok.textContent = okLabel;
  cancel.textContent = cancelLabel;
  ok.className = `btn ${danger ? 'btn--danger' : 'btn--primary'}`;

  return new Promise((resolve) => {
    const finish = (answer) => {
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      resolve(answer);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onClose = () => finish(false);
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
    cancel.focus();      // safest default: Cancel is focused, not Delete
  });
}

/* ----- Field errors ----- */
function setFieldError(input, message) {
  const field = input.closest('.field') || input.closest('.image-picker')?.closest('.field');
  const error = field && $('.field-error', field);
  input.setAttribute('aria-invalid', 'true');
  if (error) {
    error.textContent = message;
    error.hidden = false;
    if (!error.id) error.id = `${input.id || input.name}-error`;
    const described = new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
    described.add(error.id);
    input.setAttribute('aria-describedby', [...described].join(' '));
  }
}
function clearFieldErrors(root) {
  $$('[aria-invalid="true"]', root).forEach((input) => input.removeAttribute('aria-invalid'));
  $$('.field-error', root).forEach((error) => { error.hidden = true; error.textContent = ''; });
}
/** Shows all errors; focuses the first one. Returns true if there were none. */
function showErrors(root, errors) {
  clearFieldErrors(root);
  errors.forEach(({ input, message }) => setFieldError(input, message));
  if (errors.length) errors[0].input.focus();
  return errors.length === 0;
}


/* ===== Login ===== */
const AUTH_VIEW_TITLES = { signin: 'Admin sign in', forgot: 'Reset password', recovery: 'Set a new password' };

/** Shows one of the three login-card forms: signin | forgot | recovery. */
function showAuthView(name) {
  $$('[data-auth-view]').forEach((form) => { form.hidden = form.dataset.authView !== name; });
  $('#login-title').textContent = AUTH_VIEW_TITLES[name];
  $('#login-sub').hidden = name !== 'signin';
  const first = $(`[data-auth-view="${name}"] input`);
  if (first) first.focus();
}

/** Message above the Sign in button (red for problems, green for good news). */
function setLoginMessage(code, type = 'error') {
  const box = $('#login-error');
  box.hidden = !code;
  box.textContent = code ? MESSAGES[code] || MESSAGES.auth_failed : '';
  box.className = `alert ${type === 'success' ? 'alert--success' : 'alert--danger'}`;
  box.setAttribute('role', type === 'success' ? 'status' : 'alert');
}

function setBusy(button, busy, label) {
  button.classList.toggle('is-loading', busy);
  button.disabled = busy;
  $('.btn-label', button).textContent = label;
}

function showLogin(messageCode = null, type = 'error') {
  $('#dashboard-view').hidden = true;
  $('#login-view').hidden = false;
  document.title = 'Zaytoon Admin — Sign in';
  $('#login-preview').hidden = !(CONFIG.allowLocalPreview && !hasSupabase());
  $('#login-note-text').innerHTML = hasSupabase()
    ? '<strong>Protected by Supabase Auth.</strong> Only accounts with the admin role can open the dashboard. Your password is checked by Supabase and never stored by this app.'
    : '<strong>Sign-in is not configured yet.</strong> Add the Supabase URL and public anon key in supabase-config.js.';
  showAuthView('signin');
  setLoginMessage(messageCode, type);
}

function initLogin() {
  const form = $('#login-form');
  const email = $('#login-email');
  const password = $('#login-password');
  const submit = $('#login-submit');

  $$('[data-show-auth-view]').forEach((button) => button.addEventListener('click', () => {
    setLoginMessage(null);
    $('#forgot-status').hidden = true;
    if (button.dataset.showAuthView === 'forgot') $('#forgot-email').value = email.value.trim();
    showAuthView(button.dataset.showAuthView);
  }));

  // Show / hide password
  $('#toggle-password').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(show));
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  // ---- Sign in ----
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setLoginMessage(null);

    const errors = [];
    if (!email.value.trim()) errors.push({ input: email, message: 'Please enter your email.' });
    else if (!email.validity.valid) errors.push({ input: email, message: 'Please enter a valid email address.' });
    if (!password.value) errors.push({ input: password, message: 'Please enter your password.' });
    if (!showErrors(form, errors)) return;

    setBusy(submit, true, 'Signing in…');
    // The password goes straight to Supabase Auth; it is cleared from the field immediately.
    const result = await AuthService.signIn(email.value.trim(), password.value);
    password.value = '';

    if (result.error) {
      setBusy(submit, false, 'Sign in');
      setLoginMessage(['timeout', 'network'].includes(result.error) ? 'network' : result.error);
      return;
    }

    // Signed in — now ask the DATABASE whether this account is an admin
    let isAdmin = false;
    try {
      isAdmin = await AuthService.isAdmin();
    } catch (error) {
      setBusy(submit, false, 'Sign in');
      await AuthService.signOut();
      setLoginMessage(error.code === 'offline' ? 'network' : 'auth_failed');
      return;
    }
    setBusy(submit, false, 'Sign in');

    if (!isAdmin) {
      await AuthService.signOut();      // a normal account never reaches the dashboard
      setLoginMessage('unauthorized');
      return;
    }
    Session.clear();
    Session.user = result.session.user;
    Session.isAdmin = true;
    enterDashboard();
  });

  // ---- Forgot password ----
  const forgotForm = $('#forgot-form');
  forgotForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('#forgot-email');
    const status = $('#forgot-status');
    status.hidden = true;
    const errors = [];
    if (!input.value.trim() || !input.validity.valid) errors.push({ input, message: 'Please enter a valid email address.' });
    if (!showErrors(forgotForm, errors)) return;

    const button = $('#forgot-submit');
    setBusy(button, true, 'Sending…');
    // The reset link brings the owner back to this page (must be in Supabase's Redirect URLs)
    const redirectTo = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : undefined;
    const result = auth() ? await auth().requestPasswordReset(input.value.trim(), redirectTo) : { error: 'not_configured' };
    setBusy(button, false, 'Send reset link');

    const code = result.ok ? 'reset_sent' : (['timeout', 'network', 'offline'].includes(result.error) ? 'network' : result.error);
    status.textContent = MESSAGES[code] || MESSAGES.auth_failed;
    status.className = `alert ${result.ok ? 'alert--success' : 'alert--danger'}`;
    status.hidden = false;
  });

  // ---- Set a new password (from the email link) ----
  const recoveryForm = $('#recovery-form');
  recoveryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const first = $('#new-password');
    const second = $('#new-password-2');
    const box = $('#recovery-error');
    box.hidden = true;
    const errors = [];
    if (first.value.length < 10) errors.push({ input: first, message: 'Please use at least 10 characters.' });
    else if (first.value !== second.value) errors.push({ input: second, message: 'The two passwords do not match.' });
    if (!showErrors(recoveryForm, errors)) return;

    const button = $('#recovery-submit');
    setBusy(button, true, 'Saving…');
    const result = await auth().updatePassword(first.value);
    first.value = '';
    second.value = '';
    setBusy(button, false, 'Save new password');

    if (result.error) {
      if (result.error === 'session_expired') { showLogin('invalid_link'); return; }
      box.textContent = MESSAGES[['timeout', 'network', 'offline'].includes(result.error) ? 'network' : result.error] || MESSAGES.auth_failed;
      box.hidden = false;
      return;
    }
    await AuthService.signOut();       // the recovery session never opens the dashboard
    showLogin('password_updated', 'success');
  });

  $('#open-preview').addEventListener('click', () => {
    if (!CONFIG.allowLocalPreview || hasSupabase()) return;
    Session.clear();
    Session.preview = true;
    enterDashboard();
  });

  // Supabase Auth events
  AuthService.onAuthStateChange((event, session, reason) => {
    const dashboardOpen = !$('#dashboard-view').hidden && !Session.preview;
    if (event === 'SIGNED_OUT' && dashboardOpen) {
      // Signed out or session ended: remove access immediately
      forceLogout(reason === 'session_expired' ? 'session_expired' : null);
    } else if (event === 'USER_UPDATED' && session && dashboardOpen) {
      fill('userLabel', `Signed in as ${session.user.email}`);
    }
    // SIGNED_IN, TOKEN_REFRESHED: nothing to do (the dashboard is only opened after the admin check)
  });

  // Back / forward cache: re-check the real session when a page is shown again
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) verifyAccess();
  });
}

/** Re-checks session + admin role; closes the dashboard if either is missing. */
async function verifyAccess() {
  if ($('#dashboard-view').hidden || Session.preview) return;
  const session = await AuthService.getSession();
  if (!session) { forceLogout('session_expired'); return; }
  try {
    if (!(await AuthService.isAdmin())) forceLogout('unauthorized');
  } catch (error) { /* offline: keep the screen; every write is still checked by the database */ }
}

/** Called when a request finds the session has ended. */
function handleSessionExpired() {
  if (!$('#dashboard-view').hidden && !Session.preview) {
    AuthService.signOut();
    forceLogout('session_expired');
  }
}


/* ===== Dashboard: enter / leave ===== */
async function enterDashboard() {
  $('#login-view').hidden = true;
  $('#dashboard-view').hidden = false;
  $('#preview-banner').hidden = !Session.preview;
  fill('modeChip', Session.preview ? 'Preview' : 'Admin');
  fill('userLabel', Session.preview ? 'Local preview — not signed in' : `Signed in as ${Session.user.email}`);

  // Loading state while data is fetched
  const main = $('#main');
  main.setAttribute('aria-busy', 'true');
  try {
    await loadAllData();
  } catch (error) {
    main.removeAttribute('aria-busy');
    if (error.code === 'session_expired') { forceLogout('session_expired'); return; }
    toast(MESSAGES.load_failed, 'error');
    return;
  }
  main.removeAttribute('aria-busy');

  renderEverything();
  showPanel(panelFromHash() || 'overview', { focus: false });
}

async function loadAllData() {
  await DataService.loadBase();        // Supabase first, local files as fallback
  state.info = await DataService.loadRestaurantData();
  state.menu = await DataService.loadMenuData();
  const bundled = bundledMenu();
  state.originalImages = bundled.items.map((item) => ({ image: item.image, title: item.title, width: item.width, height: item.height }));
}

function renderEverything() {
  renderOverview();
  renderCategories();
  renderMenuFilters();
  renderMenuList();
  fillAllForms();
  renderSettings();
}

async function logout() {
  if (state.dirtyForms.size) {
    const leave = await confirmAction({
      title: 'Log out with unsaved changes?',
      text: 'Changes you have not saved will be lost.',
      okLabel: 'Log out', cancelLabel: 'Stay', danger: true
    });
    if (!leave) return;
  }
  await AuthService.signOut();     // real Supabase sign-out (the token is forgotten immediately)
  if (!$('#dashboard-view').hidden) forceLogout();
  toast('You have been logged out.');
}

/** Clears everything from the screen and memory, then shows the login. */
function forceLogout(messageCode = null) {
  Session.clear();
  state.info = null;
  state.menu = null;
  state.dirtyForms.clear();
  $('#item-list').innerHTML = '';
  $('#stats').innerHTML = '';
  $$('form[data-form]').forEach((form) => form.reset());
  $('#notice-preview').innerHTML = '';
  $('#data-source').innerHTML = '';
  $('#settings-status').innerHTML = '';
  $('#category-list').innerHTML = '';
  ['#item-dialog', '#category-dialog', '#confirm-dialog'].forEach((id) => { if ($(id).open) $(id).close(); });
  closeNav();
  history.replaceState(null, '', location.pathname);
  showLogin(messageCode);
}

function fill(name, text) {
  $$(`[data-fill="${name}"]`).forEach((el) => { el.textContent = text; });
}


/* ===== Navigation ===== */
const PANELS = ['overview', 'menu', 'restaurant', 'contact', 'availability', 'notice', 'settings'];

function panelFromHash() {
  const id = location.hash.replace('#', '');
  return PANELS.includes(id) ? id : null;
}

function showPanel(id, { focus = true } = {}) {
  if (!PANELS.includes(id)) id = 'overview';
  $$('.panel').forEach((panel) => { panel.hidden = panel.dataset.panelId !== id; });
  $$('.side-nav a').forEach((link) => {
    if (link.dataset.panel === id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  history.replaceState(null, '', `#${id}`);
  closeNav();
  if (focus) {
    const heading = $(`#panel-${id} h1`);
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}

function openNav() {
  document.body.classList.add('nav-open');
  document.documentElement.classList.add('is-locked');
  $('#nav-toggle').setAttribute('aria-expanded', 'true');
  $('#sidebar-scrim').hidden = false;
  $('.side-nav a[aria-current="page"]')?.focus();
}
function closeNav() {
  if (!document.body.classList.contains('nav-open')) return;
  document.body.classList.remove('nav-open');
  document.documentElement.classList.remove('is-locked');
  $('#nav-toggle').setAttribute('aria-expanded', 'false');
  $('#sidebar-scrim').hidden = true;
}

function initNavigation() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-panel]');
    if (!link || $('#dashboard-view').hidden) return;
    event.preventDefault();
    showPanel(link.dataset.panel);
  });
  $('#nav-toggle').addEventListener('click', () => {
    if (document.body.classList.contains('nav-open')) closeNav(); else openNav();
  });
  $('#sidebar-scrim').addEventListener('click', closeNav);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
      closeNav();
      $('#nav-toggle').focus();
    }
  });
  window.matchMedia('(min-width: 1024px)').addEventListener('change', closeNav);
  $('#logout').addEventListener('click', logout);
}


/* ===== Overview ===== */
function connectionBadge() {
  const map = {
    connected: '<span class="badge badge--on">Connected</span>',
    unreachable: '<span class="badge badge--warn">Unreachable — showing local data</span>',
    not_configured: '<span class="badge badge--off">Not configured</span>'
  };
  return map[DataService.connection];
}

function renderOverview() {
  const items = state.menu.items;
  const available = items.filter((item) => item.active !== false).length;
  const info = state.info;

  const stat = (label, value, note = '', textValue = false) => `
    <article class="stat">
      <p class="stat-label">${escapeHtml(label)}</p>
      <p class="stat-value ${textValue ? 'stat-value--text' : ''}">${value}</p>
      ${note ? `<p class="stat-note">${escapeHtml(note)}</p>` : ''}
    </article>`;

  $('#stats').innerHTML = [
    stat('Total menu items', items.length, `${available} available to customers`),
    stat('Menu categories', state.menu.categories.length),
    stat('Delivery', `<span class="badge ${info.deliveryActive ? 'badge--on' : 'badge--off'}">${info.deliveryActive ? 'Active' : 'Unavailable'}</span>`, '', true)
  ].join('');

  const row = (label, value) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
  $('#data-source').innerHTML = [
    row('Content', DataService.source === 'supabase' ? 'Supabase database' : 'Local project files'),
    row('Supabase database', connectionBadge()),
    row('Signed in', Session.preview
      ? '<span class="badge badge--warn">Local preview — not signed in</span>'
      : `<span class="badge badge--on">${escapeHtml(Session.user ? Session.user.email : '')} · admin</span>`),
    row('Preview changes', DataService.hasPreviewChanges()
      ? '<span class="badge badge--warn">Saved in this browser</span>' : 'None'),
    row('Last save', DataService.lastSaved ? formatTime(DataService.lastSaved) : '—')
  ].join('');
}


/* ===== Menu management ===== */
function categoryLabel(id) {
  const category = state.menu.categories.find((c) => c.id === id);
  return category ? category.label : 'No category';
}

function sortedCategories() {
  return state.menu.categories.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function renderMenuFilters() {
  const select = $('#menu-filter');
  select.innerHTML = `<option value="all">All categories</option>` +
    sortedCategories().map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join('');
  if (![...select.options].some((o) => o.value === state.menuCategory)) state.menuCategory = 'all';
  select.value = state.menuCategory;
}

/** Thumbnail address for an item (uploaded image, local image, or none). */
function thumbFor(item) {
  return item.image || imageUrlFor(item.imagePath) || '';
}

function renderMenuList(highlightId = null) {
  const query = state.menuQuery.trim().toLowerCase();
  const items = state.menu.items
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((item) => state.menuCategory === 'all' || item.category === state.menuCategory)
    .filter((item) => !query || [item.title, item.titlePs, item.description, categoryLabel(item.category)]
      .join(' ').toLowerCase().includes(query));

  $('#menu-count').textContent = `${items.length} of ${state.menu.items.length} items`;
  $('#menu-empty').hidden = items.length > 0;

  $('#item-list').innerHTML = items.map((item) => {
    const name = escapeHtml(item.title || 'Untitled');
    const active = item.active !== false;
    const thumb = thumbFor(item);
    return `
      <li class="item ${active ? '' : 'is-inactive'}" data-id="${escapeHtml(item.id)}">
        ${thumb
          ? `<img class="item-thumb" src="${escapeHtml(encodeURI(thumb))}" alt="" loading="lazy" width="64" height="90">`
          : '<span class="item-thumb item-thumb--missing">No image</span>'}
        <div>
          <p class="item-name">${name}
            ${item.titlePs ? `<span class="item-name-ps" lang="ps" dir="rtl">${escapeHtml(item.titlePs)}</span>` : ''}</p>
          ${item.description ? `<p class="item-desc">${escapeHtml(item.description)}</p>` : ''}
        </div>
        <div class="item-meta">
          <span><span class="col-label">Category: </span>${escapeHtml(categoryLabel(item.category))}</span>
          <span><span class="col-label">Price: </span>${escapeHtml(formatPrice(item.price))}</span>
          <span class="badge ${active ? 'badge--on' : 'badge--off'}">${active ? 'Available' : 'Hidden'}</span>
        </div>
        <div class="item-actions">
          <button class="btn btn--secondary btn--small" type="button" data-edit="${escapeHtml(item.id)}"
                  aria-label="Edit ${name}">
            <svg class="icon" aria-hidden="true"><use href="#a-edit"/></svg>Edit
          </button>
          <button class="btn btn--danger-ghost btn--small" type="button" data-delete="${escapeHtml(item.id)}"
                  aria-label="Delete ${name}">
            <svg class="icon" aria-hidden="true"><use href="#a-trash"/></svg>Delete
          </button>
        </div>
      </li>`;
  }).join('');

  // Missing image → neat placeholder instead of a broken-image icon
  $$('img.item-thumb', $('#item-list')).forEach((img) => {
    img.addEventListener('error', () => {
      const placeholder = document.createElement('span');
      placeholder.className = 'item-thumb item-thumb--missing';
      placeholder.textContent = 'No image';
      img.replaceWith(placeholder);
    }, { once: true });
  });

  if (highlightId) {
    const row = $(`.item[data-id="${CSS.escape(highlightId)}"]`);
    if (row) {
      row.scrollIntoView({ block: 'nearest' });
      row.animate?.([{ backgroundColor: '#eef3e1' }, { backgroundColor: '#ffffff' }], { duration: 1600 });
    }
  }
}

/** After any save: reload what is now stored and redraw. */
async function refreshMenuState(highlightId = null) {
  state.menu = await DataService.loadMenuData();
  if (!DataService.isPreview) state.info = await DataService.loadRestaurantData();
  renderMenuFilters();
  renderCategories();
  renderMenuList(highlightId);
  renderOverview();
}

function initMenuManagement() {
  $('#menu-search').addEventListener('input', (event) => {
    state.menuQuery = event.target.value;
    renderMenuList();
  });
  $('#menu-filter').addEventListener('change', (event) => {
    state.menuCategory = event.target.value;
    renderMenuList();
  });
  $('#add-item').addEventListener('click', () => openItemDialog(null));

  $('#item-list').addEventListener('click', async (event) => {
    const editId = event.target.closest('[data-edit]')?.dataset.edit;
    const deleteId = event.target.closest('[data-delete]')?.dataset.delete;
    if (editId) openItemDialog(state.menu.items.find((item) => item.id === editId));
    if (deleteId) deleteItem(deleteId);
  });

  initItemDialog();
  initCategories();
}

const pendingDeletes = new Set();   // stops a second click from deleting the same thing twice

/** Disables a row's buttons while it is being deleted. */
function setRowBusy(selector, busy) {
  const row = $(selector);
  if (row) $$('button', row).forEach((button) => { button.disabled = busy; });
}

async function deleteItem(id) {
  const item = state.menu.items.find((entry) => entry.id === id);
  if (!item || pendingDeletes.has(`item:${id}`)) return;
  const uploaded = hasSupabase() && window.ZaytoonData.isStoragePath(item.imagePath);
  const ok = await confirmAction({
    title: 'Are you sure you want to remove this menu item?',
    text: `“${item.title}” will be removed from the menu. ${uploaded
      ? 'Its uploaded image will also be removed from storage.'
      : 'The image file in img/ is not deleted.'}`,
    okLabel: 'Delete'
  });
  if (!ok) return;

  pendingDeletes.add(`item:${id}`);
  setRowBusy(`.item[data-id="${CSS.escape(id)}"]`, true);
  try {
    await DataService.deleteMenuItem(item, state.menu);
    await refreshMenuState();
    toast(`“${item.title}” was removed${Session.preview ? ' (preview only)' : ''}.`);
  } catch (error) {
    await refreshMenuState();      // show the real, unchanged data
    toast(AdminError.from(error).message, 'error');
  } finally {
    pendingDeletes.delete(`item:${id}`);
  }
}


/* ----- Categories ----- */
let editingCategory = null;
let categoryFormSnapshot = '';

function renderCategories() {
  const list = $('#category-list');
  if (!list) return;
  $('#category-count').textContent = String(state.menu.categories.length);
  list.innerHTML = sortedCategories().map((c) => {
    const count = state.menu.items.filter((item) => item.category === c.id).length;
    const name = escapeHtml(c.label);
    return `
      <li class="cat" data-id="${escapeHtml(c.id)}">
        <div class="cat-name">
          <strong>${name}</strong>
          ${c.labelPs ? `<span lang="ps" dir="rtl">${escapeHtml(c.labelPs)}</span>` : ''}
        </div>
        <span class="cat-meta">Order ${escapeHtml(c.order ?? 0)} · ${count} item${count === 1 ? '' : 's'}</span>
        <span class="badge ${c.active !== false ? 'badge--on' : 'badge--off'}">${c.active !== false ? 'Visible' : 'Hidden'}</span>
        <div class="item-actions">
          <button class="btn btn--secondary btn--small" type="button" data-cat-edit="${escapeHtml(c.id)}" aria-label="Edit category ${name}">
            <svg class="icon" aria-hidden="true"><use href="#a-edit"/></svg>Edit
          </button>
          <button class="btn btn--danger-ghost btn--small" type="button" data-cat-delete="${escapeHtml(c.id)}" aria-label="Delete category ${name}">
            <svg class="icon" aria-hidden="true"><use href="#a-trash"/></svg>Delete
          </button>
        </div>
      </li>`;
  }).join('');
}

function categoryFormValues(form) {
  const f = form.elements;
  return { label: f.label.value.trim(), labelPs: f.labelPs.value.trim(), description: f.description.value.trim(),
    order: f.order.value.trim(), active: f.active.checked };
}

function openCategoryDialog(category) {
  const form = $('#category-form');
  const f = form.elements;
  editingCategory = category;
  $('#category-dialog-title').textContent = category ? 'Edit category' : 'Add category';
  $('#category-save').textContent = category ? 'Save Changes' : 'Save';
  $('#category-form-error').hidden = true;
  clearFieldErrors(form);
  const nextOrder = Math.max(0, ...state.menu.categories.map((c) => c.order || 0)) + 1;
  f.label.value = category ? category.label : '';
  f.labelPs.value = category ? category.labelPs || '' : '';
  f.description.value = category ? category.description || '' : '';
  f.order.value = String(category ? category.order ?? 0 : nextOrder);
  f.active.checked = category ? category.active !== false : true;
  categoryFormSnapshot = JSON.stringify(categoryFormValues(form));
  $('#category-dialog').showModal();
  f.label.focus();
}

async function closeCategoryDialog({ force = false } = {}) {
  const changed = JSON.stringify(categoryFormValues($('#category-form'))) !== categoryFormSnapshot;
  if (changed && !force) {
    const discard = await confirmAction({ title: 'Discard changes?', text: 'The changes to this category will not be saved.',
      okLabel: 'Discard', cancelLabel: 'Keep editing' });
    if (!discard) return;
  }
  $('#category-dialog').close();
  editingCategory = null;
}

async function deleteCategory(id) {
  const category = state.menu.categories.find((c) => c.id === id);
  if (!category || pendingDeletes.has(`category:${id}`)) return;
  const count = state.menu.items.filter((item) => item.category === id).length;
  if (count) {
    toast(`“${category.label}” still has ${count} item${count === 1 ? '' : 's'}. Move or delete them first.`, 'error');
    return;
  }
  const ok = await confirmAction({
    title: 'Delete this category?',
    text: `“${category.label}” has no menu items and will be removed.`,
    okLabel: 'Delete'
  });
  if (!ok) return;
  pendingDeletes.add(`category:${id}`);
  setRowBusy(`.cat[data-id="${CSS.escape(id)}"]`, true);
  try {
    await DataService.deleteCategory(category, state.menu);
    await refreshMenuState();
    toast(`Category removed${Session.preview ? ' (preview only)' : ''}.`);
  } catch (error) {
    await refreshMenuState();
    toast(AdminError.from(error).message, 'error');
  } finally {
    pendingDeletes.delete(`category:${id}`);
  }
}

function initCategories() {
  const dialog = $('#category-dialog');
  const form = $('#category-form');
  $('#add-category').addEventListener('click', () => openCategoryDialog(null));
  $('#category-list').addEventListener('click', (event) => {
    const editId = event.target.closest('[data-cat-edit]')?.dataset.catEdit;
    const deleteId = event.target.closest('[data-cat-delete]')?.dataset.catDelete;
    if (editId) openCategoryDialog(state.menu.categories.find((c) => c.id === editId));
    if (deleteId) deleteCategory(deleteId);
  });
  $$('[data-dialog-cancel]', dialog).forEach((b) => b.addEventListener('click', () => closeCategoryDialog()));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeCategoryDialog(); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = form.elements;
    const values = categoryFormValues(form);
    const errors = [];
    if (!values.label) errors.push({ input: f.label, message: 'Please enter the category name.' });
    else if (state.menu.categories.some((c) => c !== editingCategory && c.label.toLowerCase() === values.label.toLowerCase())) {
      errors.push({ input: f.label, message: 'A category with this name already exists.' });
    }
    if (!/^-?\d{1,4}$/.test(values.order)) errors.push({ input: f.order, message: 'Please enter a whole number, e.g. 3.' });
    if (!showErrors(form, errors)) return;

    const data = { ...values, order: Number(values.order) };
    const save = $('#category-save');
    save.disabled = true;
    try {
      if (editingCategory) await DataService.updateCategory(editingCategory, data, state.menu);
      else await DataService.createCategory(data, state.menu);
      await closeCategoryDialog({ force: true });
      await refreshMenuState();
      toast(`Category saved${Session.preview ? ' (preview only)' : ''}.`);
    } catch (error) {
      const box = $('#category-form-error');
      box.textContent = AdminError.from(error).message;
      box.hidden = false;
      await refreshMenuState();
    } finally {
      save.disabled = false;
    }
  });
}


/* ----- Add / edit item dialog ----- */
let editingItem = null;
let itemFormSnapshot = '';
let uploadPreviewUrl = null;

function itemFormValues(form) {
  const f = form.elements;
  return {
    title: f.title.value.trim(),
    titlePs: f.titlePs.value.trim(),
    description: f.description.value.trim(),
    price: f.price.value.trim(),
    category: f.category.value,
    image: f.image.value,
    order: f.order.value.trim(),
    active: f.active.checked,
    upload: f.upload.files.length ? f.upload.files[0].name : ''
  };
}

function openItemDialog(item) {
  const dialog = $('#item-dialog');
  const form = $('#item-form');
  const f = form.elements;
  editingItem = item;

  $('#item-dialog-title').textContent = item ? 'Edit menu item' : 'Add menu item';
  $('#item-save').textContent = item ? 'Save Changes' : 'Save';
  $('#item-form-error').hidden = true;
  clearFieldErrors(form);

  // Category options
  f.category.innerHTML = `<option value="">Choose a category…</option>` +
    sortedCategories().map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join('');

  // Image options: no image, the app's own images, and the item's uploaded image (if any)
  const options = [`<option value="">No image</option>`];
  if (item && item.imagePath && !item.imagePath.startsWith('img/')) {
    options.push(`<option value="${escapeHtml(item.imagePath)}">Current uploaded image</option>`);
  }
  state.originalImages.forEach((entry) => {
    const file = entry.image.split('/').pop();
    options.push(`<option value="${escapeHtml(entry.image)}">${escapeHtml(entry.title)} — ${escapeHtml(file)}</option>`);
  });
  f.image.innerHTML = options.join('');

  const nextOrder = Math.max(0, ...state.menu.items.map((i) => i.order || 0)) + 1;
  f.title.value = item ? item.title : '';
  f.titlePs.value = item ? item.titlePs || '' : '';
  f.description.value = item ? item.description || '' : '';
  f.price.value = item && item.price != null ? String(item.price) : '';
  f.category.value = item ? item.category : '';
  f.image.value = item ? item.imagePath || '' : '';
  f.order.value = String(item ? item.order ?? 0 : nextOrder);
  f.active.checked = item ? item.active !== false : true;
  f.upload.value = '';
  updateImagePreview();

  itemFormSnapshot = JSON.stringify(itemFormValues(form));
  dialog.showModal();
  f.title.focus();
}

function updateImagePreview() {
  const f = $('#item-form').elements;
  const preview = $('#i-image-preview');
  if (uploadPreviewUrl) { URL.revokeObjectURL(uploadPreviewUrl); uploadPreviewUrl = null; }

  if (f.upload.files.length) {
    uploadPreviewUrl = URL.createObjectURL(f.upload.files[0]);
    preview.src = uploadPreviewUrl;
    preview.hidden = false;
  } else if (f.image.value && imageUrlFor(f.image.value)) {
    preview.src = encodeURI(imageUrlFor(f.image.value));
    preview.hidden = false;
  } else {
    preview.hidden = true;
    preview.removeAttribute('src');
  }
}

async function closeItemDialog({ force = false } = {}) {
  const form = $('#item-form');
  const changed = JSON.stringify(itemFormValues(form)) !== itemFormSnapshot;
  if (changed && !force) {
    const discard = await confirmAction({
      title: 'Discard changes?',
      text: 'The changes you made to this item will not be saved.',
      okLabel: 'Discard', cancelLabel: 'Keep editing'
    });
    if (!discard) return;
  }
  $('#item-dialog').close();
  if (uploadPreviewUrl) { URL.revokeObjectURL(uploadPreviewUrl); uploadPreviewUrl = null; }
  editingItem = null;
}

function validateItemForm(form) {
  const f = form.elements;
  const errors = [];
  const values = itemFormValues(form);

  if (!values.title) errors.push({ input: f.title, message: 'Please enter the item name.' });
  if (values.price) {
    const ok = /^\d{1,7}(\.\d{1,2})?$/.test(values.price) && Number(values.price) > 0;
    if (!ok) errors.push({ input: f.price, message: 'Please enter a valid price in Afs, e.g. 250 (numbers only).' });
  }
  if (!values.category) errors.push({ input: f.category, message: 'Please choose a category.' });
  if (!/^-?\d{1,5}$/.test(values.order)) errors.push({ input: f.order, message: 'Please enter a whole number, e.g. 5.' });
  return { errors, values };
}

function initItemDialog() {
  const dialog = $('#item-dialog');
  const form = $('#item-form');
  const f = form.elements;

  f.image.addEventListener('change', updateImagePreview);
  f.upload.addEventListener('change', updateImagePreview);
  $$('[data-dialog-cancel]', dialog).forEach((button) => button.addEventListener('click', () => closeItemDialog()));

  // Escape key: ask before discarding changes
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeItemDialog();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { errors, values } = validateItemForm(form);
    if (!showErrors(form, errors)) return;

    const save = $('#item-save');
    save.disabled = true;
    $('#item-form-error').hidden = true;

    // 1. New image chosen? Check it, then upload it (signed-in admins only)
    let uploaded = null;
    if (f.upload.files.length) {
      try {
        save.textContent = 'Uploading image…';
        uploaded = await DataService.uploadImage(f.upload.files[0]);
      } catch (error) {
        showErrors(form, [{ input: f.upload, message: AdminError.from(error).message }]);
        save.disabled = false;
        save.textContent = editingItem ? 'Save Changes' : 'Save';
        return;
      }
    }

    const imagePath = uploaded ? uploaded.path : (values.image || null);
    const known = state.originalImages.find((entry) => entry.image === imagePath);
    const previousImage = editingItem ? editingItem.imagePath : null;
    const data = {
      title: values.title,
      titlePs: values.titlePs,
      description: values.description,
      price: values.price ? Number(values.price) : null,
      category: values.category,
      imagePath,
      width: uploaded ? uploaded.width : (known ? known.width : (editingItem && editingItem.width) || 1080),
      height: uploaded ? uploaded.height : (known ? known.height : (editingItem && editingItem.height) || 1527),
      order: Number(values.order),
      active: values.active
    };

    // 2. Save the item
    save.textContent = 'Saving…';
    try {
      const wasEditing = Boolean(editingItem);
      const savedId = wasEditing
        ? await DataService.updateMenuItem(editingItem, data, state.menu)
        : await DataService.createMenuItem(data, state.menu);

      // 3. Replaced an uploaded image? Remove the old one (never local img/ files)
      if (previousImage && previousImage !== imagePath) await DataService.discardUploadedImage(previousImage);

      await closeItemDialog({ force: true });
      await refreshMenuState(savedId);
      const message = uploaded ? 'Image uploaded successfully. Menu item saved successfully.' : 'Menu item saved successfully.';
      toast(Session.preview ? message.replace(/\.$/, ' (preview only).') : message);
    } catch (error) {
      // Save failed: remove the just-uploaded image so no unused file is left behind
      if (uploaded) await DataService.discardUploadedImage(uploaded.path);
      const box = $('#item-form-error');
      box.textContent = AdminError.from(error).message;
      box.hidden = false;
      state.menu = await DataService.loadMenuData();   // nothing is silently changed on screen
      renderMenuList();
    } finally {
      save.disabled = false;
      save.textContent = editingItem ? 'Save Changes' : 'Save';
    }
  });
}


/* ===== Settings forms (restaurant, contact, social, availability, notice) ===== */

/** Reads/writes each form's fields from/to the current data. */
const FORMS = {
  restaurant: {
    fill: (f, info) => {
      f.name.value = info.name || '';
      f.namePs.value = info.namePs || '';
      f.addressPs.value = info.address.ps || '';
      f.addressEn.value = info.address.en || '';
      f.mapUrl.value = info.address.mapUrl || '';
    },
    validate: (f) => {
      const errors = [];
      if (!f.name.value.trim()) errors.push({ input: f.name, message: 'Please enter the restaurant name.' });
      if (!f.addressPs.value.trim()) errors.push({ input: f.addressPs, message: 'Please enter the address in Pashto.' });
      if (!f.addressEn.value.trim()) errors.push({ input: f.addressEn, message: 'Please enter the address in English.' });
      const map = f.mapUrl.value.trim();
      if (map && !isValidHttpsUrl(map)) errors.push({ input: f.mapUrl, message: 'Please enter a full link starting with https://' });
      return errors;
    },
    save: (f) => DataService.saveRestaurantData({
      name: f.name.value.trim(),
      namePs: f.namePs.value.trim(),
      address: { ...state.info.address, ps: f.addressPs.value.trim(), en: f.addressEn.value.trim(), mapUrl: f.mapUrl.value.trim() || null }
    })
  },

  contact: {
    fill: (f, info) => {
      ['phone1', 'phone2', 'phone3'].forEach((name, i) => { f[name].value = info.phones[i] ? info.phones[i].number : ''; });
      f.whatsapp.value = info.whatsapp ? info.whatsapp.number : '';
    },
    validate: (f) => {
      const errors = [];
      const message = 'Please use international format, e.g. +93700763176.';
      if (!f.phone1.value.trim()) errors.push({ input: f.phone1, message: 'At least one phone number is required for orders.' });
      ['phone1', 'phone2', 'phone3', 'whatsapp'].forEach((name) => {
        const value = f[name].value.trim();
        if (value && !isValidPhone(value)) errors.push({ input: f[name], message });
      });
      if (!f.whatsapp.value.trim()) errors.push({ input: f.whatsapp, message: 'Please enter the WhatsApp Contact number.' });
      return errors;
    },
    save: (f) => {
      const phones = ['phone1', 'phone2', 'phone3']
        .map((name) => normalisePhone(f[name].value))
        .filter(Boolean)
        .map((number, i) => ({ number, label: `Line ${i + 1}` }));
      return DataService.saveContactData({
        phones,
        // WhatsApp is contact only — acceptsOrders stays false
        whatsapp: { ...state.info.whatsapp, number: normalisePhone(f.whatsapp.value), acceptsOrders: false }
      });
    }
  },

  social: {
    fill: (f, info) => {
      const find = (id) => (info.social || []).find((link) => link.id === id);
      f.facebook.value = find('facebook') ? find('facebook').url : '';
      f.tiktok.value = find('tiktok') ? find('tiktok').url : '';
    },
    validate: (f) => {
      const errors = [];
      const fb = f.facebook.value.trim();
      const tt = f.tiktok.value.trim();
      if (fb && !isValidHttpsUrl(fb, ['facebook.com', 'fb.com', 'fb.me']))
        errors.push({ input: f.facebook, message: 'Please enter a valid Facebook link starting with https://' });
      if (tt && !isValidHttpsUrl(tt, ['tiktok.com']))
        errors.push({ input: f.tiktok, message: 'Please enter a valid TikTok link starting with https://' });
      return errors;
    },
    save: (f) => {
      const existing = state.info.social || [];
      const entry = (id, label, url) => ({ ...(existing.find((s) => s.id === id) || { icon: null }), id, label, url });
      const social = [];
      if (f.facebook.value.trim()) social.push(entry('facebook', 'Facebook', f.facebook.value.trim()));
      if (f.tiktok.value.trim()) social.push(entry('tiktok', 'TikTok', f.tiktok.value.trim()));
      return DataService.saveSocialData(social);
    }
  },

  availability: {
    fill: (f, info) => {
      f.deliveryActive.checked = Boolean(info.deliveryActive);
      f.deliveryPs.value = info.deliveryText.ps || '';
      f.deliveryEn.value = info.deliveryText.en || '';
    },
    validate: (f) => ['deliveryPs', 'deliveryEn']
      .filter((name) => !f[name].value.trim())
      .map((name) => ({ input: f[name], message: 'This text is required.' })),
    save: (f) => DataService.saveRestaurantData({
      deliveryActive: f.deliveryActive.checked,
      deliveryText: { ps: f.deliveryPs.value.trim(), en: f.deliveryEn.value.trim() }
    })
  },

  notice: {
    fill: async (f) => {
      f.notice.value = await DataService.loadNoticeData();
      renderNoticePreview();
    },
    validate: (f) => (f.notice.value.trim()
      ? []
      : [{ input: f.notice, message: 'The notice cannot be empty.' }]),
    save: (f) => DataService.saveNoticeData(f.notice.value.replace(/\s+$/, ''))
  }
};

function formSnapshot(form) {
  return JSON.stringify($$('input, textarea, select', form)
    .map((el) => (el.type === 'checkbox' ? el.checked : el.value)));
}

function setFormStatus(form, text, type = '') {
  const status = $('.form-status', form);
  status.textContent = text;
  status.className = `form-status ${type ? `is-${type}` : ''}`;
}

async function fillForm(form) {
  const name = form.dataset.form;
  await FORMS[name].fill(form.elements, state.info);   // form.elements avoids clashes with built-in form properties like form.name
  clearFieldErrors(form);
  form.dataset.snapshot = formSnapshot(form);
  state.dirtyForms.delete(name);
  setFormStatus(form, '');
}

function fillAllForms() {
  $$('form[data-form]').forEach((form) => fillForm(form));
}

function initSettingsForms() {
  $$('form[data-form]').forEach((form) => {
    const name = form.dataset.form;

    // Track unsaved changes
    form.addEventListener('input', () => {
      if (!state.info) return;
      const dirty = formSnapshot(form) !== form.dataset.snapshot;
      if (dirty) state.dirtyForms.add(name); else state.dirtyForms.delete(name);
      setFormStatus(form, dirty ? 'Unsaved changes' : '', dirty ? 'dirty' : '');
    });

    // "Undo changes" restores the last saved values (not empty fields)
    form.addEventListener('reset', (event) => {
      if (!state.info) return;     // logging out: let the browser clear the form
      event.preventDefault();
      fillForm(form);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const config = FORMS[name];
      if (!showErrors(form, config.validate(form.elements))) {
        setFormStatus(form, 'Please correct the highlighted fields.', 'error');
        return;
      }

      const button = $('button[type="submit"]', form);
      button.disabled = true;
      setFormStatus(form, 'Saving…');
      try {
        state.info = await config.save(form.elements);
        form.dataset.snapshot = formSnapshot(form);
        state.dirtyForms.delete(name);
        setFormStatus(form, `Saved at ${formatTime(new Date())}${Session.preview ? ' — preview only, not published' : ''}`, 'saved');
        const messages = {
          restaurant: 'Restaurant information updated.', contact: 'Contact details updated.',
          social: 'Social links updated.', availability: 'Availability updated.', notice: 'Notice updated.'
        };
        toast(`${messages[name] || 'Saved.'}${Session.preview ? ' (preview only)' : ''}`);
        renderOverview();
        renderSettings();
        if (name !== 'notice') refreshNoticeIfUnchanged();
      } catch (error) {
        setFormStatus(form, error.message, 'error');
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  });

  $('#f-notice').addEventListener('input', renderNoticePreview);
}

/** Keeps the generated notice in step with phone/address/status edits, unless it was edited by hand. */
function refreshNoticeIfUnchanged() {
  const form = $('#form-notice');
  if (state.info.notice && state.info.notice.text) return;   // custom notice: leave it alone
  if (state.dirtyForms.has('notice')) return;
  fillForm(form);
}


/* ===== Notice preview ===== */
function renderNoticePreview() {
  const text = $('#f-notice').value;
  const preview = $('#notice-preview');
  const count = $('#f-notice-count');
  count.textContent = `${text.length} / 2000 characters`;

  if (!text.trim()) {
    preview.innerHTML = '<p class="preview-empty">The notice is empty.</p>';
    return;
  }
  // Each line becomes a paragraph; phone numbers stay left-to-right inside the Pashto text
  preview.innerHTML = text.split('\n').map((line) => {
    const safe = escapeHtml(line).replace(/(\+?\d[\d\s]{6,}\d)/g, '<span dir="ltr">$1</span>');
    return `<p>${safe || '&nbsp;'}</p>`;
  }).join('');
}


/* ===== Settings panel ===== */
function renderSettings() {
  const row = (label, value) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
  $('#settings-status').innerHTML = [
    row('Internet', navigator.onLine ? '<span class="badge badge--on">Online</span>' : '<span class="badge badge--warn">Offline</span>'),
    row('Database (Supabase)', connectionBadge()),
    row('Image storage', !hasSupabase() ? '<span class="badge badge--off">Not configured</span>'
      : Session.preview ? '<span class="badge badge--warn">Uploads off in preview</span>'
        : '<span class="badge badge--on">Ready (admins only)</span>'),
    row('Sign-in (Supabase Auth)', hasSupabase() ? '<span class="badge badge--on">Active</span>'
      : '<span class="badge badge--off">Not configured</span>'),
    row('Mode', Session.preview ? 'Local preview' : 'Signed in')
  ].join('');
}

function initSettingsPanel() {
  $('#export-data').addEventListener('click', async () => {
    const data = await DataService.exportPreview();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'zaytoon-preview-data.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Preview data exported.');
  });

  $('#reset-data').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: 'Reset preview changes?',
      text: 'All changes saved in this browser will be removed and the app’s current data will be shown again.',
      okLabel: 'Reset'
    });
    if (!ok) return;
    DataService.resetPreview();
    await loadAllData();
    renderEverything();
    toast('Preview changes were reset.');
  });
}


/* ===== Network ===== */
function initNetwork() {
  const banner = $('#net-banner');
  const update = () => {
    banner.hidden = navigator.onLine;
    if (state.info) renderSettings();
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

/* Warn before closing the tab with unsaved changes */
window.addEventListener('beforeunload', (event) => {
  if (state.dirtyForms.size) {
    event.preventDefault();
    event.returnValue = '';
  }
});


/* ---------- 6. Start-up ---------- */
async function initAdmin() {
  fill('namePs', (window.ZAYTOON_INFO && window.ZAYTOON_INFO.namePs) || '');
  initLogin();
  initNavigation();
  initMenuManagement();
  initSettingsForms();
  initSettingsPanel();
  initNetwork();

  // 1. Opened from a password-reset email? (the token is removed from the URL at once)
  const recovery = auth() ? await auth().consumeRecoveryLink() : null;
  if (recovery === 'recovery') {
    showLogin();
    const session = await AuthService.getSession();
    fill('recoveryEmail', session ? session.user.email : '');
    showAuthView('recovery');
    return;
  }

  // 2. Otherwise always start at the login: the session is kept in memory only,
  //    so a newly opened (or reloaded) admin page never shows the dashboard
  //    until Supabase Auth + the admin check have passed again.
  showLogin(recovery === 'invalid_link' ? 'invalid_link' : null);
}

document.addEventListener('DOMContentLoaded', initAdmin);
