/* ==========================================================
   Zaytoon Restaurant — Supabase data service (Step 7, secured in Step 8)
   ----------------------------------------------------------
   The ONLY file that talks to Supabase. The customer app
   (script.js) and the admin panel (admin.js) call the
   functions below — no raw database queries anywhere else.

     UI  →  ZaytoonData (this file)  →  Supabase REST / Storage API

   No library is needed: Supabase exposes plain HTTPS APIs, so
   this uses fetch(). That keeps the app dependency-free, light,
   and working when index.html is opened directly.

   SECURITY
   • Requests use the PUBLIC anon key from supabase-config.js.
   • What a request may do is decided by Row Level Security in
     the database — not by this file. Today the public can only
     READ; every write is refused until admin sign-in (Step 8).
   • Admin calls pass `{ accessToken }` — the signed-in admin's
     session token from supabase-auth.js. It is passed in from
     memory, never stored or logged by this file.
   ========================================================== */

'use strict';

globalThis.ZaytoonData = (() => {
  const CFG = globalThis.ZAYTOON_SUPABASE || {};
  const BUCKET = CFG.storageBucket || 'menu-images';
  const LOCAL_IMAGE_PREFIX = 'img/';           // images shipped with the app
  const STORAGE_IMAGE_PREFIX = 'items/';       // uploads: menu-images/items/<uuid>.<ext>

  // Image upload rules
  const ALLOWED_IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const MAX_SOURCE_BYTES = 15 * 1024 * 1024;   // largest photo we accept before resizing
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;    // matches the bucket limit in supabase-schema.sql
  const MAX_IMAGE_SIDE = 2000;                 // px — sharp on phones, not wastefully large
  const IMAGE_QUALITY = 0.9;                   // keeps food photos looking good


  /* ---------- Errors (friendly codes; raw database errors are never shown to customers) ---------- */
  class DataError extends Error {
    constructor(code, detail = null, status = 0) {
      super(code);
      this.name = 'DataError';
      this.code = code;        // not_configured | offline | timeout | network | permission | session_expired |
                               // not_found | conflict | invalid | server | category_not_empty | bad_image
                               // | invalid_credentials | rate_limited (auth)
      this.status = status;
      this.detail = detail;    // for developers (console) only
    }
  }

  function codeForStatus(status, detail, hadToken) {
    const pgCode = detail && detail.code;
    const text = JSON.stringify(detail || '').toLowerCase();
    // A signed-in request refused because the session token is expired / invalid
    if (hadToken && status === 401 && (/jwt|expired|token/.test(text) || pgCode === 'PGRST301' || pgCode === 'PGRST303')) {
      return 'session_expired';
    }
    if (status === 429) return 'rate_limited';
    if (status === 401 || status === 403 || pgCode === '42501') return 'permission';
    if (status === 404) return 'not_found';
    if (status === 409 || pgCode === '23503' || pgCode === '23505') return 'conflict';
    if (status === 400 || status === 422 || pgCode === '23514') return 'invalid';
    return 'server';
  }


  /* ---------- Connection ---------- */
  function isConfigured() {
    return typeof CFG.url === 'string' && /^https?:\/\/\S+$/.test(CFG.url)
      && typeof CFG.anonKey === 'string' && CFG.anonKey.length > 20;
  }

  function baseUrl() {
    return CFG.url.replace(/\/+$/, '');
  }

  /** One HTTPS request to Supabase, with a time limit and friendly errors. */
  async function request(path, { method = 'GET', body, headers = {}, accessToken = null, raw = false } = {}) {
    if (!isConfigured()) throw new DataError('not_configured');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new DataError('offline');

    const isBinary = typeof Blob !== 'undefined' && body instanceof Blob;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CFG.requestTimeoutMs || 8000);

    let response;
    try {
      response = await fetch(baseUrl() + path, {
        method,
        signal: controller.signal,
        headers: {
          apikey: CFG.anonKey,
          Authorization: `Bearer ${accessToken || CFG.anonKey}`,
          ...(body !== undefined && !isBinary ? { 'Content-Type': 'application/json' } : {}),
          ...headers
        },
        body: body === undefined ? undefined : (isBinary ? body : JSON.stringify(body))
      });
    } catch (error) {
      throw new DataError(error.name === 'AbortError' ? 'timeout' : 'network', error);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let detail = null;
      try { detail = await response.json(); } catch (error) { /* not JSON */ }
      throw new DataError(codeForStatus(response.status, detail, Boolean(accessToken)), detail, response.status);
    }
    if (raw) return response;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  /* ---------- Columns actually used by the app (no select=*) ---------- */
  const COLUMNS = {
    settings: 'id,restaurant_name,restaurant_name_ps,address,address_en,map_url,delivery_active,delivery_text_ps,'
      + 'delivery_text_en,whatsapp_number,updated_at',
    phones: 'id,phone_number,label,sort_order',
    social: 'id,facebook_url,tiktok_url',
    notice: 'id,notice_text,updated_at',
    categories: 'id,slug,name,name_ps,description,sort_order,is_active',
    items: 'id,slug,category_id,name,name_ps,description,price,image_path,image_width,image_height,is_available,sort_order'
  };

  /* ---------- Small REST helpers (PostgREST syntax) ---------- */
  const enc = encodeURIComponent;

  function select(table, query, { accessToken } = {}) {
    return request(`/rest/v1/${table}?${query}`, { accessToken });
  }

  /** Calls a database function, e.g. rpc('is_admin', {}, { accessToken }). */
  function rpc(name, args = {}, { accessToken } = {}) {
    if (!/^[a-z_]+$/.test(name)) throw new DataError('invalid');
    return request(`/rest/v1/rpc/${name}`, { method: 'POST', body: args, accessToken });
  }

  async function insert(table, row, { accessToken, upsertOn = null } = {}) {
    const conflict = upsertOn ? `?on_conflict=${enc(upsertOn)}` : '';
    const rows = await request(`/rest/v1/${table}${conflict}`, {
      method: 'POST',
      body: row,
      accessToken,
      headers: { Prefer: `return=representation${upsertOn ? ',resolution=merge-duplicates' : ''}` }
    });
    if (!Array.isArray(rows) || !rows.length) throw new DataError('permission');
    return Array.isArray(row) ? rows : rows[0];
  }

  /** PATCH; RLS silently skips rows you may not change, so "0 rows" is treated as "not allowed". */
  async function update(table, filter, changes, { accessToken } = {}) {
    const rows = await request(`/rest/v1/${table}?${filter}`, {
      method: 'PATCH', body: changes, accessToken, headers: { Prefer: 'return=representation' }
    });
    if (!Array.isArray(rows) || !rows.length) throw new DataError('permission');
    return rows;
  }

  async function remove(table, filter, { accessToken } = {}) {
    const rows = await request(`/rest/v1/${table}?${filter}`, {
      method: 'DELETE', accessToken, headers: { Prefer: 'return=representation' }
    });
    if (!Array.isArray(rows) || !rows.length) throw new DataError('permission');
    return rows;
  }


  /* ======================= Restaurant settings ======================= */
  async function getRestaurantSettings(options = {}) {
    const rows = await select('restaurant_settings', `select=${COLUMNS.settings}&limit=1`, options);
    return rows[0] || null;
  }

  async function updateRestaurantSettings(changes, options = {}) {
    const current = await getRestaurantSettings(options);
    if (!current) throw new DataError('not_found');
    const allowed = ['restaurant_name', 'restaurant_name_ps', 'address', 'address_en', 'map_url',
      'delivery_active', 'delivery_text_ps', 'delivery_text_en', 'whatsapp_number'];
    const clean = Object.fromEntries(Object.entries(changes).filter(([key]) => allowed.includes(key)));
    const [row] = await update('restaurant_settings', `id=eq.${enc(current.id)}`, clean, options);
    return row;
  }

  /* ======================= Phone numbers ======================= */
  async function getRestaurantPhones(options = {}) {
    return select('restaurant_phones', `select=${COLUMNS.phones}&is_active=eq.true&order=sort_order.asc`, options);
  }

  /**
   * Saves the phone list in order. Existing numbers are updated, new ones added,
   * and numbers no longer listed are switched OFF (not deleted) — nothing is lost.
   */
  async function updateRestaurantPhones(phones, options = {}) {
    const rows = phones.map((phone, index) => ({
      phone_number: phone.number,
      label: phone.label || `Line ${index + 1}`,
      sort_order: index + 1,
      is_active: true
    }));
    const saved = await insert('restaurant_phones', rows, { ...options, upsertOn: 'phone_number' });
    const keep = rows.map((row) => `"${row.phone_number}"`).join(',');
    try {
      await update('restaurant_phones', `phone_number=not.in.(${enc(keep)})&is_active=eq.true`, { is_active: false }, options);
    } catch (error) {
      if (error.code !== 'permission') throw error;   // "0 rows" = nothing left to switch off
    }
    return saved;
  }

  /* ======================= Social links ======================= */
  async function getSocialLinks(options = {}) {
    const rows = await select('social_links', `select=${COLUMNS.social}&limit=1`, options);
    return rows[0] || null;
  }

  async function updateSocialLinks({ facebook_url, tiktok_url }, options = {}) {
    const current = await getSocialLinks(options);
    if (!current) throw new DataError('not_found');
    const [row] = await update('social_links', `id=eq.${enc(current.id)}`,
      { facebook_url: facebook_url || null, tiktok_url: tiktok_url || null }, options);
    return row;
  }

  /* ======================= Notice ======================= */
  async function getRestaurantNotice(options = {}) {
    const rows = await select('restaurant_notice', `select=${COLUMNS.notice}&is_active=eq.true&order=updated_at.desc&limit=1`, options);
    return rows[0] || null;
  }

  async function updateRestaurantNotice(noticeText, options = {}) {
    const current = await getRestaurantNotice(options);
    if (current) {
      const [row] = await update('restaurant_notice', `id=eq.${enc(current.id)}`, { notice_text: noticeText }, options);
      return row;
    }
    return insert('restaurant_notice', { notice_text: noticeText, is_active: true }, options);
  }

  /* ======================= Menu categories ======================= */
  async function getMenuCategories(options = {}) {
    return select('menu_categories', `select=${COLUMNS.categories}&order=sort_order.asc,name.asc`, options);
  }

  function categoryRow(data) {
    const row = {};
    if ('slug' in data) row.slug = data.slug;
    if ('name' in data) row.name = data.name;
    if ('name_ps' in data) row.name_ps = data.name_ps || null;
    if ('description' in data) row.description = data.description || null;
    if ('sort_order' in data) row.sort_order = Number(data.sort_order) || 0;
    if ('is_active' in data) row.is_active = Boolean(data.is_active);
    return row;
  }

  function createMenuCategory(data, options = {}) {
    return insert('menu_categories', categoryRow(data), options);
  }

  async function updateMenuCategory(id, data, options = {}) {
    const [row] = await update('menu_categories', `id=eq.${enc(id)}`, categoryRow(data), options);
    return row;
  }

  /** Refuses to delete a category that still has items (the database refuses too). */
  async function deleteMenuCategory(id, options = {}) {
    const items = await select('menu_items', `select=id&category_id=eq.${enc(id)}`, options);
    if (items.length) throw new DataError('category_not_empty', { count: items.length });
    await remove('menu_categories', `id=eq.${enc(id)}`, options);
  }

  /* ======================= Menu items ======================= */
  async function getMenuItems(options = {}) {
    return select('menu_items', `select=${COLUMNS.items}&order=sort_order.asc,name.asc`, options);
  }

  function itemRow(data) {
    const row = {};
    const copy = ['slug', 'category_id', 'name', 'name_ps', 'description', 'image_path',
      'image_width', 'image_height', 'is_available', 'sort_order'];
    copy.forEach((key) => { if (key in data) row[key] = data[key] === '' ? null : data[key]; });
    if ('price' in data) row.price = data.price === '' || data.price == null ? null : Number(data.price);
    return row;
  }

  function createMenuItem(data, options = {}) {
    return insert('menu_items', itemRow(data), options);
  }

  async function updateMenuItem(id, data, options = {}) {
    const [row] = await update('menu_items', `id=eq.${enc(id)}`, itemRow(data), options);
    return row;
  }

  /**
   * Deletes the database row first; only then removes its UPLOADED image
   * (never a local img/ file, never any other path).
   */
  async function deleteMenuItem(id, options = {}) {
    const [row] = await remove('menu_items', `id=eq.${enc(id)}`, options);
    if (options.deleteImage !== false && isStoragePath(row.image_path)) {
      try {
        await deleteMenuImage(row.image_path, options);
      } catch (error) {
        console.warn('[Zaytoon data] Item deleted, but its image could not be removed:', row.image_path, error);
      }
    }
    return row;
  }


  /* ======================= Images ======================= */
  function isLocalPath(path) {
    return typeof path === 'string' && path.startsWith(LOCAL_IMAGE_PREFIX);
  }

  /**
   * Only paths this app itself generates may be deleted from Storage:
   * items/<uuid>.<ext>, categories/<uuid>.<ext> (and Step 7's menu-items/…).
   * Anything else — local img/ files, "..", other folders — is refused.
   */
  function isStoragePath(path) {
    return typeof path === 'string'
      && /^(items|categories|menu-items)\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/.test(path);
  }

  /** Address of an image: local file as-is, Storage image as its public URL. */
  function getImageUrl(path) {
    if (!path) return '';
    if (isLocalPath(path)) return path;
    if (!isConfigured()) return '';
    return `${baseUrl()}/storage/v1/object/public/${BUCKET}/${path.split('/').map(enc).join('/')}`;
  }

  /** Reads the first bytes to confirm the file really is JPG / PNG / WebP (the name is not trusted). */
  async function sniffImageType(file) {
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to));
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    return null;
  }

  /** Validates a chosen file. Returns its real type, or throws DataError('bad_image', { reason }). */
  async function validateImageFile(file) {
    if (!file || typeof file.size !== 'number') throw new DataError('bad_image', { reason: 'missing' });
    if (file.size === 0) throw new DataError('bad_image', { reason: 'empty' });
    if (!ALLOWED_IMAGE_TYPES[file.type]) throw new DataError('bad_image', { reason: 'type' });
    if (file.size > MAX_SOURCE_BYTES) throw new DataError('bad_image', { reason: 'too_large' });
    const realType = await sniffImageType(file);
    if (!realType) throw new DataError('bad_image', { reason: 'not_an_image' });
    return realType;
  }

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new DataError('bad_image', { reason: 'unreadable' })); };
      img.src = url;
    });
  }

  /**
   * Validates, then gently resizes large photos (longest side 2000 px, quality 0.9).
   * Small images are uploaded unchanged. Returns { blob, type, ext, width, height }.
   */
  async function prepareImage(file) {
    const type = await validateImageFile(file);
    const img = await loadImage(file);
    let { naturalWidth: width, naturalHeight: height } = img;
    const tooBig = Math.max(width, height) > MAX_IMAGE_SIDE || file.size > 1.5 * 1024 * 1024;

    if (!tooBig) return { blob: file, type, ext: ALLOWED_IMAGE_TYPES[type], width, height };

    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);

    // Photos compress far better as WebP/JPEG than PNG
    const target = type === 'image/png' ? 'image/webp' : type;
    let blob = await new Promise((resolve) => canvas.toBlob(resolve, target, IMAGE_QUALITY));
    if (!blob || blob.type !== target) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', IMAGE_QUALITY));
    }
    if (!blob) throw new DataError('bad_image', { reason: 'unreadable' });
    if (blob.size > MAX_UPLOAD_BYTES) throw new DataError('bad_image', { reason: 'too_large' });
    return { blob, type: blob.type, ext: ALLOWED_IMAGE_TYPES[blob.type], width, height };
  }

  function randomId() {
    if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  /** Uploads a menu image to Storage under a NEW safe name. Returns { path, width, height }. */
  async function uploadMenuImage(file, options = {}) {
    const prepared = await prepareImage(file);
    const path = `${STORAGE_IMAGE_PREFIX}${randomId()}.${prepared.ext}`;   // browser file name is ignored
    await request(`/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      body: prepared.blob,
      accessToken: options.accessToken,
      headers: { 'Content-Type': prepared.type, 'x-upsert': 'false', 'cache-control': '31536000' },
      raw: true
    });
    return { path, width: prepared.width, height: prepared.height };
  }

  /** Deletes ONE uploaded image. Local img/ files and unexpected paths are always refused. */
  async function deleteMenuImage(path, options = {}) {
    if (!isStoragePath(path)) throw new DataError('invalid', { reason: 'unsafe_path', path });
    await request(`/storage/v1/object/${BUCKET}/${path}`, {
      method: 'DELETE', accessToken: options.accessToken, raw: true
    });
  }


  /* ======================= Everything the customer app needs ======================= */

  /**
   * Loads all public data in one go and converts it to the SAME shape as the
   * local files (restaurant-data.js / menu-data.js), so the existing UI works unchanged.
   * `local` = { info, menu } from the local files, used for defaults and image fallback.
   */
  async function loadPublicData(local, options = {}) {
    // options.accessToken: signed-in admins also receive hidden items/categories (RLS decides)
    const [settings, phones, social, notice, categories, items] = await Promise.all([
      getRestaurantSettings(options), getRestaurantPhones(options), getSocialLinks(options),
      getRestaurantNotice(options), getMenuCategories(options), getMenuItems(options)
    ]);
    if (!settings) throw new DataError('not_found', { table: 'restaurant_settings' });
    return toAppData({ settings, phones, social, notice, categories, items }, local);
  }

  function toAppData({ settings, phones, social, notice, categories, items }, local) {
    const base = JSON.parse(JSON.stringify((local && local.info) || {}));
    const localItems = (local && local.menu && local.menu.items) || [];

    const socialList = [];
    const existingSocial = (id) => (base.social || []).find((s) => s.id === id) || { icon: null };
    if (social && social.facebook_url) socialList.push({ ...existingSocial('facebook'), id: 'facebook', label: 'Facebook', url: social.facebook_url });
    if (social && social.tiktok_url) socialList.push({ ...existingSocial('tiktok'), id: 'tiktok', label: 'TikTok', url: social.tiktok_url });

    const info = {
      ...base,
      name: settings.restaurant_name,
      namePs: settings.restaurant_name_ps || base.namePs || '',
      phones: phones.map((p, i) => ({ number: p.phone_number, label: p.label || `Line ${i + 1}`, dbId: p.id })),
      whatsapp: {
        ...(base.whatsapp || {}),
        number: settings.whatsapp_number || (base.whatsapp && base.whatsapp.number) || '',
        acceptsOrders: false   // WhatsApp is contact only — always
      },
      social: socialList,
      address: { ps: settings.address, en: settings.address_en || '', mapUrl: settings.map_url || null },
      deliveryActive: settings.delivery_active,
      deliveryText: {
        ps: settings.delivery_text_ps || (base.deliveryText && base.deliveryText.ps) || '',
        en: settings.delivery_text_en || (base.deliveryText && base.deliveryText.en) || ''
      },
      notice: { ...(base.notice || {}), text: notice ? notice.notice_text : undefined, dbId: notice ? notice.id : null },
      updatedAt: settings.updated_at
    };

    const slugById = Object.fromEntries(categories.map((c) => [c.id, c.slug || c.id]));
    const menu = {
      version: 1,
      categories: categories.map((c) => ({
        id: c.slug || c.id, dbId: c.id, label: c.name, labelPs: c.name_ps || '',
        description: c.description || '', order: c.sort_order, active: c.is_active
      })),
      items: items.map((row) => {
        const localMatch = localItems.find((item) => item.id === row.slug);
        const image = getImageUrl(row.image_path);
        return {
          id: row.slug || row.id,
          dbId: row.id,
          image: image || null,
          imagePath: row.image_path || null,
          // If an uploaded image cannot load, fall back to the original local image (if there is one)
          fallbackImage: localMatch && localMatch.image !== image ? localMatch.image : null,
          category: slugById[row.category_id] || '',
          categoryDbId: row.category_id,
          title: row.name,
          titlePs: row.name_ps || '',
          description: row.description || '',
          price: row.price == null ? null : Number(row.price),
          width: row.image_width || 1080,
          height: row.image_height || 1527,
          order: row.sort_order,
          active: row.is_available
        };
      })
    };
    return { info, menu };
  }

  return Object.freeze({
    DataError,
    isConfigured,
    request,          // low-level HTTPS call (used by supabase-auth.js)
    rpc,
    // restaurant
    getRestaurantSettings, updateRestaurantSettings,
    getRestaurantPhones, updateRestaurantPhones,
    getSocialLinks, updateSocialLinks,
    getRestaurantNotice, updateRestaurantNotice,
    // menu
    getMenuCategories, createMenuCategory, updateMenuCategory, deleteMenuCategory,
    getMenuItems, createMenuItem, updateMenuItem, deleteMenuItem,
    // images
    validateImageFile, prepareImage, uploadMenuImage, deleteMenuImage,
    getImageUrl, isLocalPath, isStoragePath,
    // customer app
    loadPublicData, toAppData
  });
})();
