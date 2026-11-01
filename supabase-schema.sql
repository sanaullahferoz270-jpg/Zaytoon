-- ==========================================================
-- Zaytoon Restaurant — Supabase schema (Step 7)
-- ----------------------------------------------------------
-- HOW TO USE
--   Supabase Dashboard → SQL Editor → New query → paste this
--   whole file → Run. It is safe to run more than once
--   (tables use IF NOT EXISTS, seed rows use ON CONFLICT).
--
-- WHAT IT CREATES
--   Tables:  restaurant_settings, restaurant_phones, social_links,
--            restaurant_notice, menu_categories, menu_items
--   Storage: public bucket "menu-images" (JPG / PNG / WebP, max 5 MB)
--   Security: Row Level Security ON for every table.
--            The public (anon) role can only READ public rows.
--            Admin write access is added by supabase-security.sql (Step 8).
--
-- It does not modify any other database objects.
-- ==========================================================


-- ----------------------------------------------------------
-- 0. Helper: keep updated_at current automatically
-- ----------------------------------------------------------
create or replace function public.zaytoon_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ----------------------------------------------------------
-- 1. restaurant_settings — exactly ONE row
-- ----------------------------------------------------------
create table if not exists public.restaurant_settings (
  id                      uuid primary key default gen_random_uuid(),
  singleton               boolean not null default true unique check (singleton),  -- blocks a 2nd row
  restaurant_name         text not null check (char_length(btrim(restaurant_name)) between 1 and 120),
  restaurant_name_ps      text check (char_length(restaurant_name_ps) <= 120),
  address                 text not null check (char_length(btrim(address)) between 1 and 300),      -- Pashto
  address_en              text check (char_length(address_en) <= 300),
  map_url                 text check (map_url is null or map_url ~ '^https://'),
  delivery_active         boolean not null default true,
  delivery_text_ps        text check (char_length(delivery_text_ps) <= 120),
  delivery_text_en        text check (char_length(delivery_text_en) <= 120),
  -- WhatsApp is CONTACT ONLY — the restaurant does not accept orders on WhatsApp
  whatsapp_number         text check (whatsapp_number is null or whatsapp_number ~ '^\+[0-9]{9,15}$'),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- The "Family Place" section was removed from the website. If this database
-- was created with an older version of this file, drop its old columns.
alter table public.restaurant_settings
  drop column if exists family_place_available,
  drop column if exists family_place_text_ps,
  drop column if exists family_place_text_en;

-- ----------------------------------------------------------
-- 2. restaurant_phones — order lines (separate table: any number of
--    phones, each with its own label / order / on-off switch)
-- ----------------------------------------------------------
create table if not exists public.restaurant_phones (
  id            uuid primary key default gen_random_uuid(),
  phone_number  text not null unique check (phone_number ~ '^\+[0-9]{9,15}$'),
  label         text check (char_length(label) <= 40),
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------
-- 3. social_links — exactly ONE row
-- ----------------------------------------------------------
create table if not exists public.social_links (
  id            uuid primary key default gen_random_uuid(),
  singleton     boolean not null default true unique check (singleton),
  facebook_url  text check (facebook_url is null
                  or facebook_url ~* '^https://([a-z0-9-]+\.)*(facebook\.com|fb\.com|fb\.me)(/|$)'),
  tiktok_url    text check (tiktok_url is null
                  or tiktok_url ~* '^https://([a-z0-9-]+\.)*tiktok\.com(/|$)'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------
-- 4. restaurant_notice — the Pashto notice (customers see the
--    newest ACTIVE one)
-- ----------------------------------------------------------
create table if not exists public.restaurant_notice (
  id           uuid primary key default gen_random_uuid(),
  notice_text  text not null check (char_length(btrim(notice_text)) between 1 and 2000),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ----------------------------------------------------------
-- 5. menu_categories
-- ----------------------------------------------------------
create table if not exists public.menu_categories (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,59}$'),  -- stable id, e.g. "kabab"
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  name_ps      text check (char_length(name_ps) <= 80),
  description  text check (char_length(description) <= 300),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ----------------------------------------------------------
-- 6. menu_items
--    image_path is EITHER
--      • a Storage path in bucket "menu-images", e.g. "items/<uuid>.webp"
--        ("menu-items/…" = older Step 7 uploads, still accepted)
--      • or a local file shipped with the app,  e.g. "img/WhatsApp Image ….jpeg"
--    Only the path is stored — never image data.
-- ----------------------------------------------------------
create table if not exists public.menu_items (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  -- ON DELETE RESTRICT: a category that still has items cannot be deleted by accident
  category_id   uuid not null references public.menu_categories (id) on delete restrict,
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  name_ps       text check (char_length(name_ps) <= 80),
  description   text check (char_length(description) <= 300),
  price         numeric(10, 2) check (price is null or (price > 0 and price < 10000000)),  -- Afs; null = price is on the image
  image_path    text check (image_path is null or (image_path ~ '^(img/|items/|categories/|menu-items/)[^\\]+$' and image_path !~ '\.\.')),
  image_width   integer check (image_width is null or image_width > 0),
  image_height  integer check (image_height is null or image_height > 0),
  is_available  boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);


-- ----------------------------------------------------------
-- 7. Indexes (only the useful ones)
-- ----------------------------------------------------------
create index if not exists menu_items_category_id_idx    on public.menu_items (category_id);
create index if not exists menu_items_is_available_idx   on public.menu_items (is_available);
create index if not exists menu_items_sort_order_idx     on public.menu_items (sort_order);
create index if not exists menu_categories_sort_order_idx on public.menu_categories (sort_order);
create index if not exists menu_categories_is_active_idx  on public.menu_categories (is_active);


-- ----------------------------------------------------------
-- 8. updated_at triggers
-- ----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['restaurant_settings','restaurant_phones','social_links',
                           'restaurant_notice','menu_categories','menu_items']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I
                    for each row execute function public.zaytoon_set_updated_at()', t || '_updated_at', t);
  end loop;
end;
$$;


-- ----------------------------------------------------------
-- 9. Row Level Security — PUBLIC READ ONLY
--    RLS is the real security layer. Frontend checks are not.
-- ----------------------------------------------------------
alter table public.restaurant_settings enable row level security;
alter table public.restaurant_phones   enable row level security;
alter table public.social_links        enable row level security;
alter table public.restaurant_notice   enable row level security;
alter table public.menu_categories     enable row level security;
alter table public.menu_items          enable row level security;

-- Belt and braces: the public roles get no write privileges at all.
-- (Admin writes will use the "authenticated" role + admin-only RLS policies in Step 8.)
revoke insert, update, delete, truncate on
  public.restaurant_settings, public.restaurant_phones, public.social_links,
  public.restaurant_notice, public.menu_categories, public.menu_items
from anon;
grant select on
  public.restaurant_settings, public.restaurant_phones, public.social_links,
  public.restaurant_notice, public.menu_categories, public.menu_items
to anon, authenticated;

drop policy if exists "Public can read restaurant settings" on public.restaurant_settings;
create policy "Public can read restaurant settings"
  on public.restaurant_settings for select to anon, authenticated
  using (true);

drop policy if exists "Public can read active phones" on public.restaurant_phones;
create policy "Public can read active phones"
  on public.restaurant_phones for select to anon, authenticated
  using (is_active);

drop policy if exists "Public can read social links" on public.social_links;
create policy "Public can read social links"
  on public.social_links for select to anon, authenticated
  using (true);

drop policy if exists "Public can read active notice" on public.restaurant_notice;
create policy "Public can read active notice"
  on public.restaurant_notice for select to anon, authenticated
  using (is_active);

drop policy if exists "Public can read active categories" on public.menu_categories;
create policy "Public can read active categories"
  on public.menu_categories for select to anon, authenticated
  using (is_active);

drop policy if exists "Public can read available items in active categories" on public.menu_items;
create policy "Public can read available items in active categories"
  on public.menu_items for select to anon, authenticated
  using (
    is_available
    and exists (select 1 from public.menu_categories c
                where c.id = menu_items.category_id and c.is_active)
  );

-- No INSERT / UPDATE / DELETE policies exist, so with RLS enabled every
-- write from the browser is refused — for customers AND (for now) admins.


-- ----------------------------------------------------------
-- 10. Storage bucket "menu-images"
--     Public bucket = anyone can VIEW images by their public URL.
--     This file adds NO upload/update/delete policies: run
--     supabase-security.sql afterwards for the admin-only ones.
-- ----------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ----------------------------------------------------------
-- 11. Seed data — ONLY information already in the project
--     (prices are left empty: they are printed on the menu images)
-- ----------------------------------------------------------
insert into public.restaurant_settings (
  restaurant_name, restaurant_name_ps, address, address_en, map_url,
  delivery_active, delivery_text_ps, delivery_text_en,
  whatsapp_number)
values (
  'Zaytoon Restaurant', 'زیتون رستورانت',
  'دوهمه ناحیه، د غازي پارک لمرخاته طرف ته دوهم فرعي سړک، کندهار',
  'Second District, toward the sunrise side of Ghazi Park, second side street, Kandahar',
  null,
  true,  'ډلیوري: خدمات فعال دي', 'Delivery services are active',
  '+93711763176')
on conflict (singleton) do nothing;

insert into public.restaurant_phones (phone_number, label, sort_order) values
  ('+93700763176', 'Line 1', 1),
  ('+93780763176', 'Line 2', 2),
  ('+93711763176', 'Line 3', 3)
on conflict (phone_number) do nothing;

insert into public.social_links (facebook_url, tiktok_url)
values ('https://www.facebook.com/share/1X5NaqhnXc/',
        'https://www.tiktok.com/@zaytoon_restaurant?_r=1&_t=ZS-9AuFYCGgiQ8')
on conflict (singleton) do nothing;

insert into public.restaurant_notice (notice_text)
select E'السلام علیکم! 🤝\n\n📌 یادونه: په وټس اپ کې اډر نه منل کېږي ❌📲\n\n💡 مهرباني وکړئ د فرمایش لپاره یوازې لاندې شمېرو ته زنګ ووهئ ☎️👇\n\n📞 +93700763176\n📞 +93780763176\n📞 +93711763176\n\n🚚 ډلیوري: خدمات فعال دي\n\n📍 ادرس: دوهمه ناحیه، د غازي پارک لمرخاته طرف ته دوهم فرعي سړک، کندهار\n\n🙏 مننه ستاسو د همکارۍ څخه! 💛'
where not exists (select 1 from public.restaurant_notice);

-- Older databases: remove the old "Family Place" line from the saved notice
update public.restaurant_notice
set notice_text = replace(notice_text, E'\n\n🏠 فامیلي ځای: اوس مهال نسته', '')
where position('🏠 فامیلي ځای' in notice_text) > 0;

-- Categories = the headings printed on the existing menu images (menu-data.js)
insert into public.menu_categories (slug, name, name_ps, sort_order) values
  ('platter', 'Family Platters', null,     1),
  ('karahi',  'Karahi',          'کړاهي', 2),
  ('kabab',   'Kabab',           'کباب',  3),
  ('pizza',   'Pizza',           'پیزا',  4),
  ('burger',  'Burgers',         'برګر',  5),
  ('roll',    'Rolls',           'رول',   6),
  ('broast',  'Broast',          'بروست', 7),
  ('majoon',  'Majoon',          'معجون', 8),
  ('juice',   'Juice',           'جوس',   9)
on conflict (slug) do nothing;

-- Menu items = the 20 existing menu-page images in img/ (file names unchanged)
insert into public.menu_items (slug, category_id, name, name_ps, image_path, image_width, image_height, sort_order)
select v.slug, c.id, v.name, v.name_ps, v.image_path, v.w, v.h, v.sort_order
from (values
  ('sultani-platter', 'platter', 'Sultani Platter', 'سلطاني پلېټر', 'img/WhatsApp Image 2026-10-26 at 12.52.28 PM.jpeg',     2480, 3508, 1),
  ('zaytoon-shahi',   'platter', 'Zaytoon Shahi',   'زیتون شاهي',  'img/WhatsApp Image 2026-10-26 at 12.52.29 PM.jpeg',     1080, 1527, 2),
  ('platter',         'platter', 'Platter',         'پلېټر',       'img/WhatsApp Image 2026-10-26 at 12.52.29 PM (1).jpeg', 1080, 1527, 3),
  ('mandi',           'platter', 'Mandi',           'مندي',        'img/WhatsApp Image 2026-10-26 at 12.52.29 PM (2).jpeg', 1080, 1527, 4),
  ('fast-food',       'platter', 'Fast Food',       'فاست فود',    'img/WhatsApp Image 2026-10-26 at 12.52.30 PM.jpeg',     1080, 1527, 5),
  ('second-class',    'platter', 'Second Class',    'دوهمه درجه',  'img/WhatsApp Image 2026-10-26 at 12.52.30 PM (1).jpeg', 1080, 1527, 6),
  ('first-class',     'platter', 'First Class',     'اوله درجه',   'img/WhatsApp Image 2026-10-26 at 12.52.31 PM.jpeg',     1080, 1527, 7),
  ('chicken-tikka',   'platter', 'Chicken Tikka',   'چکن تیکه',    'img/WhatsApp Image 2026-10-26 at 12.52.31 PM (1).jpeg', 1080, 1527, 8),
  ('arabic',          'platter', 'Arabic',          'عربیک',       'img/WhatsApp Image 2026-10-26 at 12.52.32 PM.jpeg',     1080, 1527, 9),
  ('dastarkhwan',     'platter', 'Dastarkhwan',     'دسترخوان',    'img/WhatsApp Image 2026-10-26 at 12.52.37 PM.jpeg',     2480, 3508, 10),
  ('karahi-1',        'karahi',  'Karahi',          'کړاهي',       'img/WhatsApp Image 2026-10-26 at 12.52.38 PM.jpeg',     1080, 1527, 11),
  ('karahi-2',        'karahi',  'Karahi',          'کړاهي',       'img/WhatsApp Image 2026-10-26 at 12.52.38 PM (1).jpeg', 1080, 1527, 12),
  ('kabab-1',         'kabab',   'Kabab',           'کباب',        'img/WhatsApp Image 2026-10-26 at 12.52.39 PM (1).jpeg', 1080, 1527, 13),
  ('kabab-2',         'kabab',   'Kabab',           'کباب',        'img/WhatsApp Image 2026-10-26 at 12.52.40 PM.jpeg',     1080, 1527, 14),
  ('pizza',           'pizza',   'Pizza',           'پیزا',        'img/WhatsApp Image 2026-10-26 at 12.52.39 PM.jpeg',     1080, 1527, 15),
  ('burgers',         'burger',  'Burgers',         'برګر',        'img/WhatsApp Image 2026-10-26 at 12.52.40 PM (1).jpeg', 1080, 1527, 16),
  ('rolls',           'roll',    'Rolls',           'رول',         'img/WhatsApp Image 2026-10-26 at 12.52.41 PM (1).jpeg', 1080, 1527, 17),
  ('broast',          'broast',  'Broast',          'بروست',       'img/WhatsApp Image 2026-10-26 at 12.52.41 PM.jpeg',     1080, 1527, 18),
  ('majoon',          'majoon',  'Majoon',          'معجون',       'img/WhatsApp Image 2026-10-26 at 12.52.42 PM (1).jpeg', 1080, 1527, 19),
  ('juice',           'juice',   'Juice',           'جوس',         'img/WhatsApp Image 2026-10-26 at 12.52.42 PM.jpeg',     1080, 1527, 20)
) as v(slug, category_slug, name, name_ps, image_path, w, h, sort_order)
join public.menu_categories c on c.slug = v.category_slug
on conflict (slug) do nothing;


-- ==========================================================
-- NEXT: run supabase-security.sql (Step 8) to add Supabase Auth
-- profiles, the is_admin() check, admin-only write policies and
-- admin-only Storage upload / delete policies.
-- The service_role key is NEVER used in the browser.
-- ==========================================================
