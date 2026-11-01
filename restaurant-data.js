/* ==========================================================
   Zaytoon Restaurant — Restaurant Information (Step 4)
   ----------------------------------------------------------
   The ONLY place restaurant details are written. Every phone
   button, address, social link, status badge, the Pashto
   notice and the footer are built from this object by
   script.js, so a change here updates the whole site.

   FUTURE ADMIN PANEL
   Later this object can come from a secure database. Only
   getRestaurantInfo() in script.js needs to change, as long
   as the data keeps this same shape.
   ========================================================== */

'use strict';

window.ZAYTOON_INFO = Object.freeze({
  name: 'Zaytoon Restaurant',
  namePs: 'زیتون رستورانت',

  // Order matters: the first number is used for every "Call Now" button
  phones: [
    { number: '+93700763176', label: 'Line 1' },
    { number: '+93780763176', label: 'Line 2' },
    { number: '+93711763176', label: 'Line 3' }
  ],

  // WhatsApp is for contact only — orders are NOT accepted on WhatsApp
  whatsapp: {
    number: '+93711763176',
    acceptsOrders: false,
    warning: 'WhatsApp orders are not accepted. Please call to place an order.'
  },

  // Social links (URLs exactly as supplied). "icon" may later point to an
  // official brand icon file, e.g. 'assets/icons/facebook.svg'.
  social: [
    { id: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/share/1X5NaqhnXc/', icon: null },
    { id: 'tiktok',   label: 'TikTok',   url: 'https://www.tiktok.com/@zaytoon_restaurant?_r=1&_t=ZS-9AuFYCGgiQ8', icon: null }
  ],

  address: {
    ps: 'دوهمه ناحیه، د غازي پارک لمرخاته طرف ته دوهم فرعي سړک، کندهار',
    en: 'Second District, toward the sunrise side of Ghazi Park, second side street, Kandahar',
    // No verified map link yet — leave null. When a real link is added
    // (later via the Admin Panel) an "Open map" button appears automatically.
    mapUrl: null
  },

  deliveryActive: true,
  deliveryText: { ps: 'ډلیوري: خدمات فعال دي', en: 'Delivery services are active' },

  // Pashto restaurant notice — the remaining lines (phones, delivery,
  // address) are filled in from the fields above.
  notice: {
    greeting: 'السلام علیکم! 🤝',
    warning: '📌 یادونه: په وټس اپ کې اډر نه منل کېږي ❌📲',
    instruction: '💡 مهرباني وکړئ د فرمایش لپاره یوازې لاندې شمېرو ته زنګ ووهئ ☎️👇',
    addressLabel: 'ادرس:',
    thanks: '🙏 مننه ستاسو د همکارۍ څخه! 💛'
  }
});
