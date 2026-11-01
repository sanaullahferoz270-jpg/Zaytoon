/* ==========================================================
   Zaytoon Restaurant — Main Script (Step 7: Supabase data)
   Plain JavaScript, no libraries. Works when index.html is
   opened directly from the file system, with no Internet.

   Contents
   1.  Helpers
   2.  Header (scrolled state)
   3.  Mobile navigation
   4.  Active navigation link
   5.  Scroll-reveal animation
   6.  Offline-first data layer ← Supabase → saved copy → local files
   7.  Restaurant information   ← phones, address, social, notice, footer
   8.  Menu data source         ← the only part to change for a backend
   9.  Menu gallery (cards, categories, search, empty state)
   10. Full-screen image viewer
   11. Floating call button
   12. Offline support (service worker, online/offline badge)
   13. Start-up
   ========================================================== */

'use strict';


/* ---------- 1. Helpers ---------- */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Locks / unlocks page scrolling (used by the mobile menu and the viewer). */
function setScrollLock(locked) {
  document.documentElement.classList.toggle('is-locked', locked);
}

/** Makes an image path safe for src="" (the supplied file names contain spaces). */
function toImageUrl(path) {
  return encodeURI(path);
}

/** Escapes text before putting it into HTML. */
function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

/** Lower-cases text and unifies Arabic/Pashto letter variants so search is forgiving. */
function normaliseSearchText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/گ/g, 'ګ')
    .replace(/[ً-ٰٟ]/g, '')   // remove Arabic short-vowel marks
    .replace(/\s+/g, ' ')
    .trim();
}


/* ---------- 2. Header: darker glass after scrolling ---------- */
function initHeader() {
  const header = document.getElementById('site-header');
  if (!header) return;

  const update = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
  update();
  window.addEventListener('scroll', update, { passive: true });
}


/* ---------- 3. Mobile navigation ---------- */
function initMobileNav() {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('main-nav');
  if (!toggle || !nav) return;

  const desktopQuery = window.matchMedia('(min-width: 1024px)');

  const setOpen = (open) => {
    document.body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    setScrollLock(open);
  };

  toggle.addEventListener('click', () => {
    setOpen(!document.body.classList.contains('nav-open'));
  });

  // Close after choosing a link (section links and phone links)
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
      setOpen(false);
      toggle.focus();
    }
  });

  // If the screen grows to desktop size while the menu is open, reset it
  desktopQuery.addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });
}


/* ---------- 4. Highlight the nav link of the section in view ---------- */
function initActiveNav() {
  const links = document.querySelectorAll('.nav-link[data-section]');
  if (!links.length || !('IntersectionObserver' in window)) return;

  // Which nav item each page section belongs to
  const sectionToNav = {
    home: 'home', info: 'home',
    menu: 'menu',
    about: 'about',
    notice: 'contact', contact: 'contact'
  };

  const setActive = (navId) => {
    links.forEach((link) => {
      const isActive = link.dataset.section === navId;
      link.classList.toggle('is-active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };

  // A section counts as "current" when it crosses the middle of the screen
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) setActive(sectionToNav[entry.target.id]);
    });
  }, { rootMargin: '-45% 0px -50% 0px' });

  Object.keys(sectionToNav).forEach((id) => {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  });

  setActive('home');
}


/* ---------- 5. Scroll-reveal animation ---------- */
let revealObserver = null;

/** Starts watching elements with [data-reveal]; they fade in when scrolled into view. */
function observeReveal(elements) {
  if (!revealObserver) {
    elements.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  elements.forEach((el) => revealObserver.observe(el));
}

function initReveal() {
  if ('IntersectionObserver' in window) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  }
  observeReveal(document.querySelectorAll('[data-reveal]'));
}


/* ---------- 6. Offline-first data layer ----------

     Online:   Supabase (latest data)  →  saved copy on this device  →  app
     Offline / Supabase unavailable:   saved copy  →  local files  →  app

   • Supabase is asked ONCE per page load, with a time limit, and never
     while the device is offline (no endless retries).
   • The saved copy ("zaytoon_public_data" in localStorage) holds PUBLIC
     restaurant data only — never passwords, keys or admin information.
   • If nothing else works, the local files (menu-data.js /
     restaurant-data.js) are used, so the app never shows a blank screen. */

const PUBLIC_DATA_KEY = 'zaytoon_public_data';

// Where the data on screen came from: 'supabase' | 'saved' | 'local'
let publicDataSource = 'local';
let publicDataFailed = false;      // true if Supabase was tried and did not answer

async function loadAppData({ key, local, remote = null, isValid = (data) => Boolean(data) }) {
  if (remote) {
    if (navigator.onLine) {
      try {
        const fresh = await remote();
        if (isValid(fresh)) {
          saveDataSnapshot(key, fresh);
          publicDataSource = 'supabase';
          return fresh;
        }
        throw new Error('Online data was incomplete');
      } catch (error) {
        publicDataFailed = true;
        console.warn('[Zaytoon data] Latest data unavailable, showing saved information.', error);
      }
    }
    const saved = readDataSnapshot(key);
    if (isValid(saved)) {
      publicDataSource = 'saved';
      return saved;
    }
  }
  publicDataSource = 'local';
  return local;
}

function saveDataSnapshot(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) { /* storage full or blocked: the app still works with live/local data */ }
}

function readDataSnapshot(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).data : null;
  } catch (error) {
    return null;
  }
}

/** Restaurant info + menu, loaded once and shared by both parts of the page. */
let publicDataPromise = null;
function getPublicData() {
  if (!publicDataPromise) {
    const local = { info: window.ZAYTOON_INFO, menu: window.ZAYTOON_MENU };
    const supabaseReady = Boolean(window.ZaytoonData && window.ZaytoonData.isConfigured());
    publicDataPromise = loadAppData({
      key: PUBLIC_DATA_KEY,
      local,
      remote: supabaseReady ? () => window.ZaytoonData.loadPublicData(local) : null,
      isValid: (data) => Boolean(data && data.info && Array.isArray(data.info.phones) && data.info.phones.length
        && data.menu && Array.isArray(data.menu.items))
    });
  }
  return publicDataPromise;
}

/** Friendly note when the latest data could not be loaded (customers never see technical errors). */
function reportDataSource() {
  if (!publicDataFailed || !navigator.onLine) return;   // offline: the "Offline Mode" badge already explains it
  showToast(publicDataSource === 'saved'
    ? 'Unable to load the latest information. Showing saved information.'
    : 'Unable to load the latest information. Showing the restaurant’s standard information.');
}

/** When the connection returns, quietly refresh the saved copy for next time. */
function refreshSavedDataWhenOnline() {
  window.addEventListener('online', () => {
    if (publicDataSource === 'supabase' || !window.ZaytoonData || !window.ZaytoonData.isConfigured()) return;
    const local = { info: window.ZAYTOON_INFO, menu: window.ZAYTOON_MENU };
    window.ZaytoonData.loadPublicData(local)
      .then((fresh) => { saveDataSnapshot(PUBLIC_DATA_KEY, fresh); })
      .catch(() => { /* still unavailable: try again on the next visit */ });
  });
}


/* ---------- 7. Restaurant information ----------
   All contact details come through getRestaurantInfo():
   Supabase when available, otherwise the saved copy or restaurant-data.js. */

async function getRestaurantInfo() {
  const { info } = await getPublicData();
  if (!info || !Array.isArray(info.phones)) {
    throw new Error('Restaurant info not found. Check that restaurant-data.js is loaded before script.js.');
  }
  const clean = sanitizeInfo(info);
  // No usable phone number after cleaning? Use the restaurant's own local details instead.
  return clean.phones.length ? clean : sanitizeInfo(window.ZAYTOON_INFO);
}

/* ----- Input safety: every data source (Supabase, saved copy, local file)
   passes through here before anything is shown. Text is escaped when it is
   rendered; links and phone numbers are checked here. ----- */

const PHONE_PATTERN = /^\+\d{9,15}$/;
const SOCIAL_DOMAINS = { facebook: ['facebook.com', 'fb.com', 'fb.me'], tiktok: ['tiktok.com'] };

/** "+93 700…" → "+93700…", or null if it is not a valid international number. */
function cleanPhone(value) {
  const number = String(value ?? '').replace(/[\s\-()]/g, '');
  return PHONE_PATTERN.test(number) ? number : null;
}

/** Returns the URL only if it is https:// (and on an allowed domain); javascript:, data: etc. are refused. */
function safeHttpsUrl(value, allowedDomains = null) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (allowedDomains && !allowedDomains.some((d) => host === d || host.endsWith(`.${d}`))) return null;
    return url.href;
  } catch (error) {
    return null;
  }
}

/** Icon files: a simple relative path inside the app, or an https URL. */
function safeIconPath(value) {
  if (!value) return null;
  const path = String(value);
  if (/^[\w\-/]+\.(svg|png|webp)$/.test(path) && !path.includes('..')) return path;
  return safeHttpsUrl(path);
}

function sanitizeInfo(info) {
  const local = window.ZAYTOON_INFO || {};
  const phones = (info.phones || [])
    .map((phone) => ({ ...phone, number: cleanPhone(phone.number), label: String(phone.label || '') }))
    .filter((phone) => phone.number);
  const social = (info.social || [])
    .map((link) => ({ ...link, url: safeHttpsUrl(link.url, SOCIAL_DOMAINS[link.id] || null), icon: safeIconPath(link.icon) }))
    .filter((link) => link.url);
  const whatsappNumber = cleanPhone(info.whatsapp && info.whatsapp.number)
    || cleanPhone(local.whatsapp && local.whatsapp.number);
  return {
    ...info,
    phones,
    social,
    whatsapp: { ...(local.whatsapp || {}), ...(info.whatsapp || {}), number: whatsappNumber, acceptsOrders: false },
    address: { ...(info.address || {}), mapUrl: safeHttpsUrl(info.address && info.address.mapUrl) }
  };
}

/** "tel:" link for a phone number (keeps only + and digits). */
function telHref(number) {
  return `tel:${String(number).replace(/[^\d+]/g, '')}`;
}

/** WhatsApp chat link for a number (contact only — never for orders). */
function whatsappHref(number) {
  return `https://wa.me/${String(number).replace(/\D/g, '')}`;
}

/** Inline SVG icon from the sprite in index.html. */
function svgIcon(id, extraClass = '') {
  return `<svg class="icon ${extraClass}" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;
}

/** Social icon: an official icon file if one is set in the data, otherwise a simple line icon. */
function socialIcon(link) {
  if (link.icon) {
    return `<img class="icon icon-img" src="${encodeURI(link.icon)}" alt="" aria-hidden="true">`;
  }
  const fallback = { facebook: 'icon-like', tiktok: 'icon-music' };
  return svgIcon(fallback[link.id] || 'icon-external');
}

/** Attributes for links that leave the site (open in a new tab, safely). */
const EXTERNAL = 'target="_blank" rel="noopener noreferrer"';

/** Puts HTML into every element with data-render="name" (append keeps existing children such as titles). */
function renderInto(name, html, { append = false } = {}) {
  document.querySelectorAll(`[data-render="${name}"]`).forEach((el) => {
    if (append) el.insertAdjacentHTML('beforeend', html); else el.innerHTML = html;
  });
}

/** Builds every information / contact area of the page from one data object. */
function renderRestaurantInfo(info) {
  const name = escapeHtml(info.name);
  const phones = info.phones;
  const primary = phones[0];
  const wa = info.whatsapp;
  const address = info.address;
  const deliveryOn = Boolean(info.deliveryActive);

  const deliveryShort = deliveryOn ? 'Delivery active' : 'Delivery unavailable';
  const addressActions = `
    <div class="info-actions">
      ${address.mapUrl ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(address.mapUrl)}" ${EXTERNAL}
          aria-label="Open the restaurant location in maps (opens in a new tab)">${svgIcon('icon-pin')}Open map</a>` : ''}
      <button class="btn btn-ghost btn-sm" type="button" data-copy-address>${svgIcon('icon-copy')}Copy address</button>
    </div>`;

  // "Call Now" buttons everywhere use the first number
  document.querySelectorAll('[data-call-primary]').forEach((link) => {
    link.href = telHref(primary.number);
    link.setAttribute('aria-label', `Call Now: ${info.name}, ${primary.number}`);   // starts with the visible text (WCAG 2.5.3)
  });

  // Footer name / brand
  renderInto('footer-name', name);

  // Hero status line
  renderInto('hero-status', `
    <li><span class="status-dot ${deliveryOn ? 'status-dot--live' : ''}"></span>${deliveryShort}</li>
    <li><span class="status-dot"></span>Orders by phone only</li>`);

  // Phone links in the mobile menu and the floating call sheet
  const simplePhoneLinks = (className) => phones.map((phone) => `
    <a class="${className}" href="${telHref(phone.number)}" aria-label="Call ${name} on ${phone.number}">
      ${svgIcon('icon-phone')}<span dir="ltr">${phone.number}</span>
      <span class="phone-tag">${escapeHtml(phone.label)}</span>
    </a>`).join('');
  renderInto('nav-phones', simplePhoneLinks('nav-call-link'), { append: true });
  renderInto('sheet-phones', simplePhoneLinks('call-sheet-link'), { append: true });

  // Information cards: Delivery, Location, Call
  renderInto('info-cards', `
    <article class="info-card ${deliveryOn ? '' : 'info-card--muted'}" data-reveal>
      <span class="info-icon">${svgIcon('icon-truck')}</span>
      <h3 class="info-title">Delivery</h3>
      <p class="info-ps" lang="ps" dir="rtl">${escapeHtml(info.deliveryText.ps)}</p>
      <p class="info-text">${escapeHtml(info.deliveryText.en)}</p>
      <span class="badge ${deliveryOn ? 'badge--live' : ''}">
        <span class="status-dot ${deliveryOn ? 'status-dot--live' : ''}"></span>${deliveryOn ? 'Active' : 'Unavailable'}
      </span>
    </article>

    <article class="info-card info-card--location" id="location" data-reveal style="--reveal-delay: 80ms">
      <span class="info-icon">${svgIcon('icon-pin')}</span>
      <h3 class="info-title">Location</h3>
      <p class="info-ps" lang="ps" dir="rtl">${escapeHtml(address.ps)}</p>
      <p class="info-text">${escapeHtml(address.en)}</p>
      ${addressActions}
    </article>

    <article class="info-card info-card--call" data-reveal style="--reveal-delay: 160ms">
      <span class="info-icon">${svgIcon('icon-phone')}</span>
      <h3 class="info-title">Call to order</h3>
      <ul class="info-phones">
        ${phones.map((phone) => `
          <li><a href="${telHref(phone.number)}" aria-label="Call ${name} on ${phone.number}">
            <span dir="ltr">${phone.number}</span><span class="info-phones-call">Call</span>
          </a></li>`).join('')}
      </ul>
    </article>`);

  // Quick actions — "Call Now" is the main action; WhatsApp is contact only
  const social = info.social || [];
  renderInto('quick-actions', `
    <a class="qa qa--primary" href="${telHref(primary.number)}" aria-label="Call ${name} on ${primary.number}">
      ${svgIcon('icon-phone')}<span>Call Now</span>
    </a>
    <a class="qa" href="#menu">${svgIcon('icon-menu-book')}<span>View Menu</span></a>
    <a class="qa" href="#address">${svgIcon('icon-pin')}<span>Address</span></a>
    ${social.map((link) => `
      <a class="qa" href="${escapeHtml(link.url)}" ${EXTERNAL} aria-label="Open ${escapeHtml(link.label)} (opens in a new tab)">
        ${socialIcon(link)}<span>${escapeHtml(link.label)}</span>
      </a>`).join('')}
    <a class="qa qa--wide" href="${whatsappHref(wa.number)}" ${EXTERNAL}
       aria-label="WhatsApp contact (messages only — orders are not accepted on WhatsApp)">
      ${svgIcon('icon-chat')}<span>WhatsApp Contact</span>
    </a>`);

  // About section facts (English summary)
  renderInto('about-facts', `
    <div class="fact"><dt>${svgIcon('icon-truck')}Delivery</dt><dd>${escapeHtml(info.deliveryText.en)}.</dd></div>
    <div class="fact"><dt>${svgIcon('icon-pin')}Address</dt><dd>${escapeHtml(address.en)}.</dd></div>`);

  // Pashto notice — exact text; phone numbers become tap-to-call links
  const n = info.notice;
  if (n && typeof n.text === 'string' && n.text.trim()) {
    renderInto('notice', renderNoticeText(n.text));
  } else renderInto('notice', `
    <p class="notice-greeting">${escapeHtml(n.greeting)}</p>
    <ul class="notice-list">
      <li class="notice-item notice-item--warning">${escapeHtml(n.warning)}</li>
      <li class="notice-item">${escapeHtml(n.instruction)}</li>
      <li class="notice-item notice-phones">
        ${phones.map((phone) => `<a class="notice-phone" href="${telHref(phone.number)}" aria-label="Call ${phone.number}">📞 <span dir="ltr">${phone.number}</span></a>`).join('\n')}
      </li>
      <li class="notice-item">🚚 ${escapeHtml(info.deliveryText.ps)}</li>
      <li class="notice-item">📍 ${escapeHtml(n.addressLabel)} ${escapeHtml(address.ps)}</li>
    </ul>
    <p class="notice-thanks">${escapeHtml(n.thanks)}</p>`);

  // Contact: large call buttons
  renderInto('phone-buttons', phones.map((phone, index) => `
    <li data-reveal style="--reveal-delay: ${index * 80}ms">
      <a class="phone-btn" href="${telHref(phone.number)}" aria-label="Call ${name}, ${escapeHtml(phone.label)}: ${phone.number}">
        <span class="phone-btn-icon">${svgIcon('icon-phone')}</span>
        <span class="phone-btn-text">
          <span class="phone-btn-label">Call &middot; ${escapeHtml(phone.label)}</span>
          <span class="phone-btn-number" dir="ltr">${phone.number}</span>
        </span>
        ${svgIcon('icon-arrow', 'phone-btn-arrow')}
      </a>
    </li>`).join(''));

  // Contact: WhatsApp (contact only) with the warning right next to it
  // Bold the first sentence of the warning
  const cut = wa.warning.indexOf('. ');
  const warnFirst = cut >= 0 ? wa.warning.slice(0, cut + 1) : wa.warning;
  const warnRest = cut >= 0 ? wa.warning.slice(cut + 2) : '';
  renderInto('whatsapp-card', `
    <h3 class="contact-card-title" id="whatsapp-title">${svgIcon('icon-chat')}WhatsApp Contact</h3>
    <p class="contact-card-value" dir="ltr">${wa.number}</p>
    <div class="alert" role="note">
      ${svgIcon('icon-alert', 'alert-icon')}
      <p><strong>${escapeHtml(warnFirst)}</strong> ${escapeHtml(warnRest)}</p>
    </div>
    <div class="contact-card-actions">
      <a class="btn btn-primary" href="${telHref(primary.number)}" aria-label="Call ${name} to place an order">
        ${svgIcon('icon-phone')}Call to order
      </a>
      <a class="btn btn-ghost" href="${whatsappHref(wa.number)}" ${EXTERNAL}
         aria-label="WhatsApp contact (messages only — opens in a new tab)">
        ${svgIcon('icon-chat')}WhatsApp Contact
      </a>
    </div>`);

  // Contact: social links
  renderInto('social-card', `
    <h3 class="contact-card-title" id="social-title">${svgIcon('icon-leaf')}Follow us</h3>
    <p class="contact-card-text">See our latest dishes and news.</p>
    <div class="social-links">
      ${social.map((link) => `
        <a class="social-link" href="${escapeHtml(link.url)}" ${EXTERNAL} aria-label="Open ${escapeHtml(link.label)} (opens in a new tab)">
          ${socialIcon(link)}<span>${escapeHtml(link.label)}</span>${svgIcon('icon-external', 'social-link-arrow')}
        </a>`).join('')}
    </div>`);

  // Contact: address
  renderInto('address-card', `
    <h3 class="contact-card-title" id="address-title">${svgIcon('icon-pin')}Address</h3>
    <p class="address-ps" lang="ps" dir="rtl">${escapeHtml(address.ps)}</p>
    <p class="contact-card-text">${escapeHtml(address.en)}</p>
    ${addressActions}`);

  // Footer
  renderInto('footer-brand', `
    <p class="footer-name">${name}</p>
    <p class="footer-tag"><span class="status-dot ${deliveryOn ? 'status-dot--live' : ''}"></span>${deliveryShort} &middot; Orders by phone</p>`);
  renderInto('footer-address', `
    <p class="footer-address-ps" lang="ps" dir="rtl">${escapeHtml(address.ps)}</p>
    <p>${escapeHtml(address.en)}</p>`);
  renderInto('footer-phones', phones.map((phone) => `
    <li><a href="${telHref(phone.number)}" aria-label="Call ${name} on ${phone.number}"><span dir="ltr">${phone.number}</span></a></li>`).join(''));
  renderInto('footer-social', `
    ${social.map((link) => `
      <li><a href="${escapeHtml(link.url)}" ${EXTERNAL} aria-label="Open ${escapeHtml(link.label)} (opens in a new tab)">${escapeHtml(link.label)}</a></li>`).join('')}
    <li><a href="${whatsappHref(wa.number)}" ${EXTERNAL} aria-label="WhatsApp contact (messages only, not for orders)">WhatsApp Contact</a>
      <span class="footer-note"><span dir="ltr">${wa.number}</span> &middot; not for orders, please call</span></li>`);

  // "Copy address" buttons
  const addressText = `${address.ps}\n${address.en}`;
  document.querySelectorAll('[data-copy-address]').forEach((button) => {
    button.addEventListener('click', async () => {
      const copied = await copyText(addressText);
      showToast(copied ? 'Address copied' : 'Could not copy — please copy the address manually');
    });
  });
}

/**
 * Turns the notice text saved in Supabase (one line per row) into the same
 * layout as before: greeting, highlighted 📌 warning, tap-to-call 📞 numbers,
 * and the closing line. The text itself is shown exactly as written.
 */
function renderNoticeText(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return '';
  const phoneLine = /^📞\s*(\+?\d[\d\s]{6,}\d)\s*$/;
  const first = lines[0];
  const last = lines.length > 2 ? lines[lines.length - 1] : null;
  const middle = lines.slice(1, last ? -1 : undefined);

  const items = [];
  let phoneGroup = [];
  const flushPhones = () => {
    if (!phoneGroup.length) return;
    items.push(`<li class="notice-item notice-phones">${phoneGroup.map((number) =>
      `<a class="notice-phone" href="${telHref(number)}" aria-label="Call ${escapeHtml(number)}">📞 <span dir="ltr">${escapeHtml(number)}</span></a>`).join('\n')}</li>`);
    phoneGroup = [];
  };
  middle.forEach((line) => {
    const match = line.match(phoneLine);
    if (match) { phoneGroup.push(match[1].replace(/\s+/g, '')); return; }
    flushPhones();
    const warning = line.startsWith('📌') ? ' notice-item--warning' : '';
    items.push(`<li class="notice-item${warning}">${escapeHtml(line)}</li>`);
  });
  flushPhones();

  return `
    <p class="notice-greeting">${escapeHtml(first)}</p>
    <ul class="notice-list">${items.join('')}</ul>
    ${last ? `<p class="notice-thanks">${escapeHtml(last)}</p>` : ''}`;
}

/** Copies text to the clipboard (with an older fallback for some phones). */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) { /* fall through to the fallback */ }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch (error) {
    return false;
  }
}

/** Shows a short message at the bottom of the screen. */
let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => { toast.hidden = true; }, 300);
  }, 2400);
}

async function initRestaurantInfo() {
  try {
    renderRestaurantInfo(await getRestaurantInfo());
  } catch (error) {
    console.error('[Zaytoon info] Could not load restaurant information:', error);
  }
}


/* ---------- 8. Menu data source ----------
   getMenuData() is the ONLY place the app reads menu data from.

   Supabase menu_categories + menu_items when available (already sorted
   by sort_order), otherwise the saved copy or the local menu-data.js. */
async function getMenuData() {
  const { menu: raw } = await getPublicData();
  if (!raw || !Array.isArray(raw.items)) {
    throw new Error('Menu data not found. Check that menu-data.js is loaded before script.js.');
  }
  return normaliseMenu(raw);
}

/** Cleans and sorts raw menu data so the rest of the code can trust it. */
function normaliseMenu(raw) {
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

  const categories = (raw.categories || [])
    .filter((category) => category && category.id && category.label && category.active !== false)
    .slice()
    .sort(byOrder);

  const items = raw.items
    .filter((item) => item && item.active !== false)
    .slice()
    .sort(byOrder)
    .map((item, index) => ({
      id: item.id || `menu-${index + 1}`,
      image: item.image || null,
      fallbackImage: item.fallbackImage || null,   // local img/ copy if an uploaded image fails
      category: item.category || '',
      title: item.title || '',
      titlePs: item.titlePs || '',
      width: Number(item.width) || 1080,
      height: Number(item.height) || 1527
    }));

  return { categories, items };
}


/* ---------- 9. Menu gallery ---------- */

// Everything the menu needs to remember
const menuState = {
  categories: [],     // from getMenuData()
  items: [],          // from getMenuData()
  failed: new Set(),  // indexes of images that could not load
  category: 'all',    // selected category id
  query: ''           // search text
};

const EAGER_IMAGE_COUNT = 4;   // the first cards load straight away, the rest lazily

function categoryById(id) {
  return menuState.categories.find((category) => category.id === id) || null;
}

/** Text a menu item can be found by: page titles + category names (no invented keywords). */
function searchTextFor(item) {
  const category = categoryById(item.category);
  return normaliseSearchText([
    item.title, item.titlePs,
    category ? category.label : '', category ? category.labelPs : ''
  ].join(' '));
}

/** Builds one menu card <li>. */
function createMenuCard(item, index) {
  const category = categoryById(item.category);
  const categoryLabel = category ? category.label : '';
  const name = item.title || categoryLabel || `Menu page ${index + 1}`;
  const altText = `Zaytoon Restaurant menu page: ${name}${item.titlePs ? ` (${item.titlePs})` : ''}`;

  const li = document.createElement('li');
  li.className = 'menu-item';
  li.dataset.index = String(index);
  li.dataset.category = item.category;
  li.dataset.search = searchTextFor(item);
  li.setAttribute('data-reveal', '');
  li.style.setProperty('--reveal-delay', `${(index % 4) * 70}ms`);

  li.innerHTML = `
    <button class="menu-card" type="button" data-index="${index}">
      <span class="menu-card-media" style="--ratio: ${item.width} / ${item.height}">
        <img src="${item.image ? toImageUrl(item.image) : ''}" alt="${escapeHtml(altText)}"
             width="${item.width}" height="${item.height}"
             loading="${index < EAGER_IMAGE_COUNT ? 'eager' : 'lazy'}" decoding="async">
        <span class="menu-card-zoom" aria-hidden="true">
          <svg class="icon"><use href="#icon-expand"/></svg>
        </span>
        <span class="menu-card-fallback">
          <svg class="icon" aria-hidden="true"><use href="#icon-leaf"/></svg>
          <span>Menu image unavailable</span>
        </span>
      </span>
      <span class="menu-card-body">
        ${categoryLabel ? `<span class="menu-card-tag">${escapeHtml(categoryLabel)}</span>` : ''}
        ${item.title ? `<span class="menu-card-title">${escapeHtml(item.title)}</span>` : ''}
        ${item.titlePs ? `<span class="menu-card-title-ps" lang="ps" dir="rtl">${escapeHtml(item.titlePs)}</span>` : ''}
        <span class="visually-hidden">— open full screen</span>
      </span>
    </button>`;

  const img = li.querySelector('img');
  const media = li.querySelector('.menu-card-media');

  const onLoad = () => {
    img.classList.add('is-loaded');
    media.classList.add('is-loaded');
  };
  const onError = () => {
    // No broken-image icon: show the clean fallback card and log for developers
    menuState.failed.add(index);
    li.classList.add('is-error');
    console.warn(`[Zaytoon menu] Image failed to load: "${item.image}"`);
  };

  // If an uploaded (online) image fails, try the original local image once
  const tryFallbackOrFail = () => {
    if (item.fallbackImage && item.image !== item.fallbackImage) {
      console.warn(`[Zaytoon menu] Image failed, using local copy: "${item.image}"`);
      item.image = item.fallbackImage;          // the viewer uses the working image too
      img.addEventListener('error', onError, { once: true });
      img.src = toImageUrl(item.image);
      return;
    }
    onError();
  };

  if (!item.image) {
    img.removeAttribute('src');
    tryFallbackOrFail();
  } else if (img.complete && img.naturalWidth > 0) {
    onLoad();
  } else {
    img.addEventListener('load', onLoad);
    img.addEventListener('error', tryFallbackOrFail, { once: true });
  }

  return li;
}

/** Creates the category buttons ("All" first, then each category with its count). */
function renderMenuFilters() {
  const filters = document.getElementById('menu-filters');
  if (!filters) return;

  const countFor = (id) => menuState.items.filter((item) => item.category === id).length;

  // Only show categories when the data actually has them; otherwise just "All Menu"
  const hasCategories = menuState.categories.length > 0;
  const buttons = [{ id: 'all', label: hasCategories ? 'All' : 'All Menu', count: menuState.items.length }];
  if (hasCategories) {
    menuState.categories.forEach((category) => {
      buttons.push({ id: category.id, label: category.label, count: countFor(category.id) });
    });
  }

  filters.replaceChildren(...buttons.map((entry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.filter = entry.id;
    button.innerHTML = `${escapeHtml(entry.label)} <span class="chip-count">${entry.count}</span>`;
    return button;
  }));

  filters.addEventListener('click', (event) => {
    const button = event.target.closest('.chip');
    if (!button) return;
    menuState.category = button.dataset.filter;
    applyMenuView({ animate: true });
    button.scrollIntoView({ behavior: prefersReducedMotion.matches ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' });
  });
}

/** Wires up the search box. */
function initMenuSearch() {
  const input = document.getElementById('menu-search-input');
  const clear = document.getElementById('menu-search-clear');
  if (!input || !clear) return;

  let timer = null;
  input.addEventListener('input', () => {
    clear.hidden = input.value === '';
    clearTimeout(timer);
    timer = setTimeout(() => {
      menuState.query = normaliseSearchText(input.value);
      applyMenuView({ animate: true });
    }, 120);
  });

  // Enter closes the phone keyboard; Escape clears the search
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape' && input.value) {
      event.stopPropagation();
      resetMenuSearch();
    }
  });

  clear.addEventListener('click', () => {
    resetMenuSearch();
    input.focus();
  });
}

function resetMenuSearch() {
  const input = document.getElementById('menu-search-input');
  const clear = document.getElementById('menu-search-clear');
  if (input) input.value = '';
  if (clear) clear.hidden = true;
  menuState.query = '';
  applyMenuView({ animate: true });
}

/** Shows / hides cards for the current category + search, and updates status and empty state. */
function applyMenuView({ animate = false } = {}) {
  const { category, query } = menuState;

  // Category buttons
  document.querySelectorAll('#menu-filters .chip').forEach((chip) => {
    const isActive = chip.dataset.filter === category;
    chip.classList.toggle('is-active', isActive);
    chip.setAttribute('aria-pressed', String(isActive));
  });

  // Cards
  let visibleCount = 0;
  document.querySelectorAll('#menu-grid .menu-item').forEach((item) => {
    const matchesCategory = category === 'all' || item.dataset.category === category;
    const matchesSearch = !query || item.dataset.search.includes(query);
    const show = matchesCategory && matchesSearch;
    item.hidden = !show;

    if (show && animate && !prefersReducedMotion.matches) {
      // Short staggered fade for the cards that remain
      item.classList.remove('is-visible');
      item.style.setProperty('--reveal-delay', `${Math.min(visibleCount, 8) * 45}ms`);
      requestAnimationFrame(() => requestAnimationFrame(() => item.classList.add('is-visible')));
    }
    if (show) visibleCount += 1;
  });

  updateMenuStatus(visibleCount);
  updateMenuEmptyState(visibleCount);
}

function updateMenuStatus(visibleCount) {
  const status = document.getElementById('menu-status');
  if (!status) return;

  const total = menuState.items.length;
  const page = (n) => (n === 1 ? 'menu page' : 'menu pages');
  const category = categoryById(menuState.category);

  if (total === 0) {
    status.textContent = '';
  } else if (visibleCount === total) {
    status.innerHTML = `Showing all <strong>${total}</strong> ${page(total)}`;
  } else {
    const where = category ? ` in <strong>${escapeHtml(category.label)}</strong>` : '';
    status.innerHTML = `Showing <strong>${visibleCount}</strong> of ${total} ${page(total)}${where}`;
  }
}

function updateMenuEmptyState(visibleCount) {
  const empty = document.getElementById('menu-empty');
  if (!empty) return;

  const title = document.getElementById('menu-empty-title');
  const text = document.getElementById('menu-empty-text');
  const reset = document.getElementById('menu-empty-reset');

  empty.hidden = visibleCount > 0;
  if (visibleCount > 0) return;

  const searchText = document.getElementById('menu-search-input')?.value.trim() || '';

  if (searchText) {
    title.textContent = 'No menu pages found';
    text.textContent = `Nothing matches “${searchText}”. Try Pizza, Kabab, Burgers or Juice.`;
    reset.hidden = false;
  } else {
    title.textContent = 'Menu items coming soon.';
    text.textContent = menuState.items.length
      ? 'This category has no menu pages yet. Please check the full menu or call us.'
      : 'Please call us for today’s menu.';
    reset.hidden = menuState.items.length === 0;
  }
}

/** Indexes of the cards currently visible (respects category + search). */
function getVisibleMenuIndexes() {
  return Array.from(document.querySelectorAll('#menu-grid .menu-item:not([hidden])'))
    .map((item) => Number(item.dataset.index));
}

/** Loads the menu data and builds the whole gallery. */
async function initMenu() {
  const grid = document.getElementById('menu-grid');
  if (!grid) return;

  try {
    const data = await getMenuData();
    menuState.categories = data.categories;
    menuState.items = data.items;
  } catch (error) {
    console.error('[Zaytoon menu] Could not load menu data:', error);
    menuState.categories = [];
    menuState.items = [];
  }

  const cards = menuState.items.map(createMenuCard);
  grid.replaceChildren(...cards);
  observeReveal(cards);

  renderMenuFilters();
  initMenuSearch();
  applyMenuView();

  document.getElementById('menu-empty-reset')?.addEventListener('click', () => {
    menuState.category = 'all';
    resetMenuSearch();
  });
}


/* ---------- 10. Full-screen image viewer ---------- */
function initViewer() {
  const viewer = document.getElementById('viewer');
  const grid = document.getElementById('menu-grid');
  if (!viewer || !grid) return;

  const stage = document.getElementById('viewer-stage');
  const img = document.getElementById('viewer-img');
  const fallback = document.getElementById('viewer-fallback');
  const title = document.getElementById('viewer-title');
  const titlePs = document.getElementById('viewer-title-ps');
  const count = document.getElementById('viewer-count');
  const prevBtn = document.getElementById('viewer-prev');
  const nextBtn = document.getElementById('viewer-next');
  const closeBtn = viewer.querySelector('[data-viewer-close]');

  let playlist = [];      // indexes of the images that can be browsed
  let position = 0;       // current position inside the playlist
  let lastFocus = null;   // element to focus again after closing
  let closeTimer = null;
  let loadToken = 0;      // ignores late "load" events from a previous image

  const isOpen = () => !viewer.hidden && viewer.classList.contains('is-open');

  /** Loads neighbouring images in the background so Next / Previous feel instant. */
  const preloadNeighbours = () => {
    [position - 1, position + 1].forEach((p) => {
      const index = playlist[(p + playlist.length) % playlist.length];
      if (index === undefined || menuState.failed.has(index)) return;
      const preload = new Image();
      preload.decoding = 'async';
      if (!menuState.items[index].image) return;
      preload.src = toImageUrl(menuState.items[index].image);
    });
  };

  /** Shows the image at a playlist position. direction: 1 = next, -1 = previous, 0 = open */
  const show = (newPosition, direction = 0) => {
    if (!playlist.length) return;
    position = (newPosition + playlist.length) % playlist.length;
    const index = playlist[position];
    const item = menuState.items[index];
    const category = categoryById(item.category);
    const name = item.title || (category && category.label) || `Menu page ${index + 1}`;
    const token = ++loadToken;

    setZoom(false);
    img.classList.remove('is-ready');
    img.style.setProperty('--enter-x', prefersReducedMotion.matches ? '0px' : `${direction * 40}px`);
    fallback.hidden = true;
    img.hidden = false;
    stage.classList.add('is-loading');

    img.onload = () => {
      if (token !== loadToken) return;
      stage.classList.remove('is-loading');
      img.classList.add('is-ready');
    };
    img.onerror = () => {
      if (token !== loadToken) return;
      stage.classList.remove('is-loading');
      img.hidden = true;
      fallback.hidden = false;
      console.warn(`[Zaytoon menu] Viewer could not load image: "${item.image}"`);
    };

    img.alt = `Zaytoon Restaurant menu page: ${name}`;
    if (!item.image) {
      img.onerror();
    } else {
      img.src = toImageUrl(item.image);         // original, full-quality image
      if (img.complete && img.naturalWidth > 0) img.onload();
    }

    title.textContent = name;
    titlePs.textContent = item.titlePs;
    count.textContent = `${position + 1} / ${playlist.length}`;

    const single = playlist.length < 2;
    prevBtn.disabled = single;
    nextBtn.disabled = single;

    preloadNeighbours();
  };

  const next = () => show(position + 1, 1);
  const previous = () => show(position - 1, -1);

  const open = (menuIndex) => {
    clearTimeout(closeTimer);
    playlist = getVisibleMenuIndexes();
    if (!playlist.length) return;
    lastFocus = document.activeElement;

    viewer.hidden = false;
    setScrollLock(true);
    show(Math.max(playlist.indexOf(menuIndex), 0));

    // Next frame: add the class so the CSS opening transition runs
    requestAnimationFrame(() => requestAnimationFrame(() => viewer.classList.add('is-open')));
    closeBtn.focus({ preventScroll: true });
  };

  const close = () => {
    if (viewer.hidden) return;
    viewer.classList.remove('is-open');
    setScrollLock(document.body.classList.contains('nav-open'));
    loadToken += 1;

    closeTimer = setTimeout(() => {
      viewer.hidden = true;
      img.removeAttribute('src');
      stage.classList.remove('is-loading');
      setZoom(false);
    }, prefersReducedMotion.matches ? 0 : 350);

    if (lastFocus) lastFocus.focus({ preventScroll: true });
  };

  /* Zoom: tapping the image shows it larger; the user pans by scrolling */
  function setZoom(zoomed, clickX, clickY) {
    if (!zoomed) {
      stage.classList.remove('is-zoomed');
      return;
    }
    // Relative click point (0–1) on the image before zooming
    const rect = img.getBoundingClientRect();
    const relX = rect.width ? (clickX - rect.left) / rect.width : 0.5;
    const relY = rect.height ? (clickY - rect.top) / rect.height : 0.5;

    // Zoom to 2× the stage width, but never beyond the image's real size
    const zoomWidth = Math.min(img.naturalWidth || 2000, stage.clientWidth * 2);
    stage.style.setProperty('--zoom-width', `${Math.max(zoomWidth, stage.clientWidth)}px`);
    stage.classList.add('is-zoomed');

    // Keep the tapped point in the centre
    stage.scrollLeft = relX * img.offsetWidth - stage.clientWidth / 2;
    stage.scrollTop = relY * img.offsetHeight - stage.clientHeight / 2;
  }

  // Open from a menu card (cards whose image failed stay closed)
  grid.addEventListener('click', (event) => {
    const card = event.target.closest('.menu-card');
    if (!card) return;
    const index = Number(card.dataset.index);
    if (menuState.failed.has(index)) return;
    open(index);
  });

  closeBtn.addEventListener('click', close);
  prevBtn.addEventListener('click', previous);
  nextBtn.addEventListener('click', next);

  // Tap image = zoom in/out. Tap empty dark area = close.
  stage.addEventListener('click', (event) => {
    if (event.target === img) {
      setZoom(!stage.classList.contains('is-zoomed'), event.clientX, event.clientY);
    } else if (!stage.classList.contains('is-zoomed') && fallback.hidden) {
      close();
    }
  });

  // Keyboard (listens on the whole document so it works wherever focus is)
  document.addEventListener('keydown', (event) => {
    if (!isOpen()) return;

    switch (event.key) {
      case 'Escape':     event.preventDefault(); close(); break;
      case 'ArrowLeft':  event.preventDefault(); previous(); break;
      case 'ArrowRight': event.preventDefault(); next(); break;
      case 'Home':       event.preventDefault(); show(0, -1); break;
      case 'End':        event.preventDefault(); show(playlist.length - 1, 1); break;
      case 'Tab': {
        // Keep keyboard focus inside the viewer
        const focusable = [closeBtn, prevBtn, nextBtn].filter((el) => !el.disabled);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!viewer.contains(document.activeElement)) {
          event.preventDefault(); first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
        break;
      }
      default:
    }
  });

  // Swipe left / right on touch screens (only when not zoomed)
  let touchStartX = 0;
  let touchStartY = 0;
  stage.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
  }, { passive: true });

  stage.addEventListener('touchend', (event) => {
    if (stage.classList.contains('is-zoomed') || event.changedTouches.length !== 1) return;
    const dx = event.changedTouches[0].clientX - touchStartX;
    const dy = event.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) next(); else previous();
    }
  }, { passive: true });
}


/* ---------- 11. Floating call button (phones & tablets) ---------- */
function initCallFab() {
  const fab = document.getElementById('call-fab');
  const button = document.getElementById('call-fab-btn');
  const sheet = document.getElementById('call-sheet');
  const hero = document.getElementById('home');
  const contact = document.getElementById('contact');
  if (!fab || !button || !sheet || !hero) return;

  const setSheet = (open) => {
    sheet.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Hide phone numbers' : 'Show phone numbers');
  };

  button.addEventListener('click', () => setSheet(sheet.hidden));

  document.addEventListener('click', (event) => {
    if (!sheet.hidden && !fab.contains(event.target)) setSheet(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !sheet.hidden) setSheet(false);
  });

  // Show the button after the hero, hide it again in the contact area
  let heroVisible = true;
  let contactVisible = false;
  const update = () => {
    const visible = !heroVisible && !contactVisible;
    fab.classList.toggle('is-visible', visible);
    if (!visible) setSheet(false);
  };

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { heroVisible = entry.isIntersecting; update(); },
      { threshold: 0.15 }).observe(hero);
    if (contact) {
      new IntersectionObserver(([entry]) => { contactVisible = entry.isIntersecting; update(); },
        { threshold: 0.2 }).observe(contact);
    }
  }
}


/* ---------- 12. Offline support ---------- */

/**
 * Registers the service worker (sw.js) that saves the app for offline use.
 *
 * NOTE: browsers only allow this on http://localhost or https://.
 * When index.html is opened directly (file://) the site works normally
 * but WITHOUT the offline cache — that is a browser rule, not a bug.
 */
function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // Android app: every file is already inside the app, so it works offline without a service worker
  if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) return;

  const isWebAddress = location.protocol === 'https:' || location.protocol === 'http:';
  if (!isWebAddress || !window.isSecureContext) {
    console.info('[Zaytoon PWA] Offline cache not active: open the app from http://localhost or https:// to enable it.');
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .catch((error) => console.warn('[Zaytoon PWA] Service worker could not be registered:', error));
  });
}

/** Small "Offline Mode" / "Online" badge under the header. */
function initNetworkStatus() {
  const badge = document.getElementById('net-status');
  if (!badge) return;
  const text = badge.querySelector('.net-status-text');
  let hideTimer = null;

  const show = (online) => {
    clearTimeout(hideTimer);
    badge.classList.toggle('is-offline', !online);
    text.textContent = online ? 'Online' : 'Offline Mode';
    badge.title = online ? 'Connection restored' : 'No internet — the menu and restaurant information still work';
    badge.hidden = false;
    requestAnimationFrame(() => badge.classList.add('is-visible'));

    // "Online" disappears after a moment; "Offline Mode" stays (small) until the connection returns
    if (online) {
      hideTimer = setTimeout(() => {
        badge.classList.remove('is-visible');
        hideTimer = setTimeout(() => { badge.hidden = true; }, 400);
      }, 2500);
    }
  };

  window.addEventListener('offline', () => show(false));
  window.addEventListener('online', () => show(true));
  if (!navigator.onLine) show(false);
}

/** Facebook, TikTok, WhatsApp etc. need internet — say so honestly instead of opening a blank page. */
function initExternalLinkGuard() {
  const names = { 'facebook.com': 'Facebook', 'tiktok.com': 'TikTok', 'wa.me': 'WhatsApp' };

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="http"]');
    if (!link || navigator.onLine) return;
    if (new URL(link.href).origin === location.origin) return;   // our own pages still work offline

    event.preventDefault();
    const host = new URL(link.href).hostname.replace(/^www\./, '');
    const site = Object.keys(names).find((domain) => host.endsWith(domain));
    showToast(`${site ? names[site] : 'This link'} needs an internet connection. You are offline.`);
  });
}


/* ---------- 13. Start-up ---------- */
function setCurrentYear() {
  const yearElement = document.getElementById('current-year');
  if (yearElement) yearElement.textContent = new Date().getFullYear();
}

async function init() {
  initServiceWorker();   // offline cache (only on localhost / https)
  initNetworkStatus();
  initExternalLinkGuard();
  setCurrentYear();
  initHeader();
  initMobileNav();
  initActiveNav();

  // Loading state while the latest data is fetched (Supabase has a time limit)
  const menuStatus = document.getElementById('menu-status');
  if (menuStatus) menuStatus.textContent = 'Loading menu…';
  document.getElementById('main')?.setAttribute('aria-busy', 'true');

  await initRestaurantInfo();   // builds contact details first, so they get scroll-reveal too
  initReveal();        // before initMenu, so new menu cards can use the reveal observer
  initViewer();
  await initMenu();    // loads the menu data and builds the gallery
  document.getElementById('main')?.removeAttribute('aria-busy');
  initCallFab();
  reportDataSource();             // "Showing saved information" if the latest data could not load
  refreshSavedDataWhenOnline();
}

document.addEventListener('DOMContentLoaded', init);
