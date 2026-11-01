/* ==========================================================
   Zaytoon Restaurant — Menu Data (Step 3)
   ----------------------------------------------------------
   This is the ONLY place the menu content is defined.

   • Every "image" points to an EXISTING file in img/ — the
     file names are used exactly as supplied (never renamed).
   • Each image is one complete menu page. Food names and
     prices live inside the images themselves; nothing extra
     is invented here.
   • "title" / "titlePs" are the headings printed on each page.
     The 10 group platter pages have no shared heading, so they
     are grouped as "Family Platters" (they all list prices for
     different numbers of people).

   OFFLINE
   sw.js also loads this file, so every image listed here is
   saved for offline use automatically — no second list needed.

   FUTURE ADMIN PANEL
   Later this file can be replaced by data from a secure
   backend. Only getMenuData() in script.js needs to change,
   as long as the data keeps this same shape:

   categories: [{ id, label, labelPs?, order }]
   items:      [{ id, image, category, title, titlePs,
                  width, height, order, active }]
   ========================================================== */

'use strict';

// "globalThis" = the page's window, or the service worker (sw.js reads this
// same list to know which menu images to save for offline use).
globalThis.ZAYTOON_MENU = Object.freeze({
  version: 1,

  categories: [
    { id: 'platter', label: 'Family Platters', order: 1 },
    { id: 'karahi',  label: 'Karahi',  labelPs: 'کړاهي', order: 2 },
    { id: 'kabab',   label: 'Kabab',   labelPs: 'کباب',  order: 3 },
    { id: 'pizza',   label: 'Pizza',   labelPs: 'پیزا',  order: 4 },
    { id: 'burger',  label: 'Burgers', labelPs: 'برګر',  order: 5 },
    { id: 'roll',    label: 'Rolls',   labelPs: 'رول',   order: 6 },
    { id: 'broast',  label: 'Broast',  labelPs: 'بروست', order: 7 },
    { id: 'majoon',  label: 'Majoon',  labelPs: 'معجون', order: 8 },
    { id: 'juice',   label: 'Juice',   labelPs: 'جوس',   order: 9 }
  ],

  items: [
    // ----- Family / group platters (prices for different numbers of people) -----
    { id: 'sultani-platter', image: 'img/WhatsApp Image 2026-10-26 at 12.52.28 PM.jpeg',     category: 'platter', title: 'Sultani Platter', titlePs: 'سلطاني پلېټر', width: 2480, height: 3508, order: 1 },
    { id: 'zaytoon-shahi',   image: 'img/WhatsApp Image 2026-10-26 at 12.52.29 PM.jpeg',     category: 'platter', title: 'Zaytoon Shahi',   titlePs: 'زیتون شاهي',  width: 1080, height: 1527, order: 2 },
    { id: 'platter',         image: 'img/WhatsApp Image 2026-10-26 at 12.52.29 PM (1).jpeg', category: 'platter', title: 'Platter',         titlePs: 'پلېټر',       width: 1080, height: 1527, order: 3 },
    { id: 'mandi',           image: 'img/WhatsApp Image 2026-10-26 at 12.52.29 PM (2).jpeg', category: 'platter', title: 'Mandi',           titlePs: 'مندي',        width: 1080, height: 1527, order: 4 },
    { id: 'fast-food',       image: 'img/WhatsApp Image 2026-10-26 at 12.52.30 PM.jpeg',     category: 'platter', title: 'Fast Food',       titlePs: 'فاست فود',    width: 1080, height: 1527, order: 5 },
    { id: 'second-class',    image: 'img/WhatsApp Image 2026-10-26 at 12.52.30 PM (1).jpeg', category: 'platter', title: 'Second Class',    titlePs: 'دوهمه درجه',  width: 1080, height: 1527, order: 6 },
    { id: 'first-class',     image: 'img/WhatsApp Image 2026-10-26 at 12.52.31 PM.jpeg',     category: 'platter', title: 'First Class',     titlePs: 'اوله درجه',   width: 1080, height: 1527, order: 7 },
    { id: 'chicken-tikka',   image: 'img/WhatsApp Image 2026-10-26 at 12.52.31 PM (1).jpeg', category: 'platter', title: 'Chicken Tikka',   titlePs: 'چکن تیکه',    width: 1080, height: 1527, order: 8 },
    { id: 'arabic',          image: 'img/WhatsApp Image 2026-10-26 at 12.52.32 PM.jpeg',     category: 'platter', title: 'Arabic',          titlePs: 'عربیک',       width: 1080, height: 1527, order: 9 },
    { id: 'dastarkhwan',     image: 'img/WhatsApp Image 2026-10-26 at 12.52.37 PM.jpeg',     category: 'platter', title: 'Dastarkhwan',     titlePs: 'دسترخوان',    width: 2480, height: 3508, order: 10 },

    // ----- Single-category menu pages -----
    { id: 'karahi-1', image: 'img/WhatsApp Image 2026-10-26 at 12.52.38 PM.jpeg',     category: 'karahi', title: 'Karahi',  titlePs: 'کړاهي', width: 1080, height: 1527, order: 11 },
    { id: 'karahi-2', image: 'img/WhatsApp Image 2026-10-26 at 12.52.38 PM (1).jpeg', category: 'karahi', title: 'Karahi',  titlePs: 'کړاهي', width: 1080, height: 1527, order: 12 },
    { id: 'kabab-1',  image: 'img/WhatsApp Image 2026-10-26 at 12.52.39 PM (1).jpeg', category: 'kabab',  title: 'Kabab',   titlePs: 'کباب',  width: 1080, height: 1527, order: 13 },
    { id: 'kabab-2',  image: 'img/WhatsApp Image 2026-10-26 at 12.52.40 PM.jpeg',     category: 'kabab',  title: 'Kabab',   titlePs: 'کباب',  width: 1080, height: 1527, order: 14 },
    { id: 'pizza',    image: 'img/WhatsApp Image 2026-10-26 at 12.52.39 PM.jpeg',     category: 'pizza',  title: 'Pizza',   titlePs: 'پیزا',  width: 1080, height: 1527, order: 15 },
    { id: 'burgers',  image: 'img/WhatsApp Image 2026-10-26 at 12.52.40 PM (1).jpeg', category: 'burger', title: 'Burgers', titlePs: 'برګر',  width: 1080, height: 1527, order: 16 },
    { id: 'rolls',    image: 'img/WhatsApp Image 2026-10-26 at 12.52.41 PM (1).jpeg', category: 'roll',   title: 'Rolls',   titlePs: 'رول',   width: 1080, height: 1527, order: 17 },
    { id: 'broast',   image: 'img/WhatsApp Image 2026-10-26 at 12.52.41 PM.jpeg',     category: 'broast', title: 'Broast',  titlePs: 'بروست', width: 1080, height: 1527, order: 18 },
    { id: 'majoon',   image: 'img/WhatsApp Image 2026-10-26 at 12.52.42 PM (1).jpeg', category: 'majoon', title: 'Majoon',  titlePs: 'معجون', width: 1080, height: 1527, order: 19 },
    { id: 'juice',    image: 'img/WhatsApp Image 2026-10-26 at 12.52.42 PM.jpeg',     category: 'juice',  title: 'Juice',   titlePs: 'جوس',   width: 1080, height: 1527, order: 20 }
  ]
});
