-- ==========================================================
-- Zaytoon Restaurant — Supabase SECURITY migration (Step 8)
-- ----------------------------------------------------------
-- Run AFTER supabase-schema.sql:
--   Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run more than once.
--
-- Real security = Supabase Auth + Row Level Security (RLS) +
-- Storage policies. Hiding admin.html is NOT security.
--
-- WHO CAN DO WHAT (summary)
--   table                public (anon)          signed-in non-admin      admin
--   -------------------  ---------------------  -----------------------  ------------------------------
--   profiles             nothing                read OWN row             read all rows (no changes from app)
--   restaurant_settings  read                   read                     read, update (no insert/delete)*
--   social_links         read                   read                     read, update (no insert/delete)*
--   restaurant_phones    read active            read active              read all, insert, update, delete
--   restaurant_notice    read active            read active              read all, insert, update, delete
--   menu_categories      read active            read active              read all, insert, update, delete
--   menu_items           read available**       read available**         read all, insert, update, delete
--   storage menu-images  view by public URL     view by public URL       upload / replace / delete (items/, categories/)
--
--   *  the single settings / social row always exists, so it can't be deleted by mistake
--   ** only available items in active categories
--
-- ROLES ARE NEVER CHANGED FROM THE APP. There is no UPDATE policy on
-- profiles at all; a role can only be changed by the project owner in
-- the SQL Editor (see "MAKE AN ADMIN" at the bottom).
-- ==========================================================


-- ----------------------------------------------------------
-- 1. profiles — one row per Supabase Auth user
-- ----------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  role        text not null default 'user'
              check (role in ('user', 'staff', 'manager', 'admin')),   -- only 'admin' has rights today
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.zaytoon_set_updated_at();

-- Every new Auth user automatically gets a profile with the harmless role 'user'.
-- SECURITY DEFINER is needed because the new user cannot write to profiles.
-- It takes no input from the user (only the new auth row), has a fixed empty
-- search_path, uses fully-qualified names and no dynamic SQL.
create or replace function public.zaytoon_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.zaytoon_handle_new_user() from public, anon, authenticated;

drop trigger if exists zaytoon_on_auth_user_created on auth.users;
create trigger zaytoon_on_auth_user_created
  after insert on auth.users
  for each row execute function public.zaytoon_handle_new_user();

-- Profiles for users that existed before this migration
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;


-- ----------------------------------------------------------
-- 2. is_admin() — the ONE place that decides "is this user an admin?"
--    • Takes NO arguments: always checks the CURRENT user (auth.uid()),
--      so nobody can ask about someone else's account.
--    • SECURITY DEFINER so it can read profiles without the RLS policies
--      on profiles calling it again (prevents infinite recursion).
--    • Fixed empty search_path + fully-qualified names; no dynamic SQL.
--    • Only signed-in users may execute it.
-- ----------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;


-- ----------------------------------------------------------
-- 3. profiles security
-- ----------------------------------------------------------
alter table public.profiles enable row level security;

-- Nobody can write profiles through the API (no app-side role changes, no self-promotion)
revoke all on public.profiles from anon;
revoke insert, update, delete, truncate on public.profiles from authenticated;
grant select on public.profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
  on public.profiles for select to authenticated
  using ((select public.is_admin()));
-- (Deliberately NO insert / update / delete policies on profiles.)


-- ----------------------------------------------------------
-- 4. Content tables: admins may manage, everyone else only reads
--    The public READ policies from supabase-schema.sql stay as they are.
-- ----------------------------------------------------------

-- Public (anon) never gets write privileges; signed-in users get them, but
-- RLS below only lets ADMINS actually use them.
revoke insert, update, delete, truncate on
  public.restaurant_settings, public.restaurant_phones, public.social_links,
  public.restaurant_notice, public.menu_categories, public.menu_items
from anon;
grant insert, update, delete on
  public.restaurant_phones, public.restaurant_notice,
  public.menu_categories, public.menu_items
to authenticated;
grant update on public.restaurant_settings, public.social_links to authenticated;
revoke insert, delete, truncate on public.restaurant_settings, public.social_links from authenticated;

-- restaurant_settings: admins read + update the single row
drop policy if exists "Admins can update restaurant settings" on public.restaurant_settings;
create policy "Admins can update restaurant settings"
  on public.restaurant_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- social_links: admins read + update the single row
drop policy if exists "Admins can update social links" on public.social_links;
create policy "Admins can update social links"
  on public.social_links for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Tables admins fully manage (also lets admins SEE hidden / inactive rows)
do $$
declare t text;
begin
  foreach t in array array['restaurant_phones', 'restaurant_notice', 'menu_categories', 'menu_items']
  loop
    execute format('drop policy if exists %I on public.%I', 'Admins can manage ' || t, t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using ((select public.is_admin())) with check ((select public.is_admin()))',
      'Admins can manage ' || t, t);
  end loop;
end;
$$;


-- ----------------------------------------------------------
-- 5. Storage paths: menu-images/items/<uuid>.<ext>  (categories/ reserved)
--    "menu-items/" is the Step 7 prefix, still accepted for old rows.
-- ----------------------------------------------------------
alter table public.menu_items drop constraint if exists menu_items_image_path_check;
alter table public.menu_items add constraint menu_items_image_path_check
  check (image_path is null or (
    image_path ~ '^(img/|items/|categories/|menu-items/)[^\\]+$'
    and image_path !~ '\.\.'));


-- ----------------------------------------------------------
-- 6. Storage policies for bucket "menu-images"
--    The bucket is PUBLIC: customers view images by URL (no policy needed).
--    Listing, uploading, replacing and deleting = admins only, and only
--    for safe generated names: items/<uuid>.jpg|png|webp  or  categories/<uuid>…
--    (no other folders, no "..", no other buckets).
-- ----------------------------------------------------------
drop policy if exists "Admins can view menu image records" on storage.objects;
create policy "Admins can view menu image records"
  on storage.objects for select to authenticated
  using (bucket_id = 'menu-images' and (select public.is_admin()));

drop policy if exists "Admins can upload menu images" on storage.objects;
create policy "Admins can upload menu images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'menu-images'
    and (select public.is_admin())
    and name ~ '^(items|categories)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
  );

drop policy if exists "Admins can replace menu images" on storage.objects;
create policy "Admins can replace menu images"
  on storage.objects for update to authenticated
  using (bucket_id = 'menu-images' and (select public.is_admin()))
  with check (
    bucket_id = 'menu-images'
    and (select public.is_admin())
    and name ~ '^(items|categories)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
  );

drop policy if exists "Admins can delete menu images" on storage.objects;
create policy "Admins can delete menu images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'menu-images'
    and (select public.is_admin())
    and name ~ '^(items|categories|menu-items)/[0-9a-f-]{36}\.(jpg|png|webp)$'
  );
-- (No anon policies on storage.objects: anonymous upload / delete is impossible.)


-- ----------------------------------------------------------
-- 7. Data integrity (Step 9 audit)
--    Two categories may not share a name (ignoring case / spaces).
--    (The admin form checks this too, but the database is the real guard.)
-- ----------------------------------------------------------
create unique index if not exists menu_categories_name_unique_idx
  on public.menu_categories (lower(btrim(name)));


-- ==========================================================
-- MAKE AN ADMIN (manual, by the project owner only)
-- 1. Dashboard → Authentication → Users → "Add user" → enter the owner's
--    email + a strong password (tick "Auto Confirm User").
-- 2. Then run here in the SQL Editor (replace the email):
--      update public.profiles set role = 'admin' where email = 'owner@example.com';
-- 3. Check:   select email, role from public.profiles;
-- To remove admin rights:  update public.profiles set role = 'user' where email = '…';
-- Never put admin emails or passwords in the website files.
-- ==========================================================
