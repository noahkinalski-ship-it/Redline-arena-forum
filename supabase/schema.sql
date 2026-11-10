-- ============================================================
-- REDLINE ARENA – schemat bazy (Supabase / PostgreSQL)
-- Uruchom w: Supabase -> SQL Editor -> New query -> Run
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- tabele ----------
create table if not exists public.categories (
  slug        text primary key,
  name        text not null,
  description text not null default '',
  icon        text not null default '💬',
  grp         text not null default 'Gry',
  sort        int  not null default 100
);

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique check (char_length(username) between 3 and 24),
  role        text not null default 'user' check (role in ('user','moderator','admin')),
  banned      boolean not null default false,
  warnings    int not null default 0,
  avatar_url  text,
  discord_id  text,
  created_at  timestamptz not null default now()
);

create table if not exists public.threads (
  id           uuid primary key default gen_random_uuid(),
  category_slug text not null references public.categories(slug) on delete cascade,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  title        text not null check (char_length(title) between 3 and 120),
  pinned       boolean not null default false,
  locked       boolean not null default false,
  posts_count  int not null default 0,
  created_at   timestamptz not null default now(),
  last_post_at timestamptz not null default now()
);
create index if not exists threads_cat_idx on public.threads (category_slug, pinned desc, last_post_at desc);

create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.threads(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);
create index if not exists posts_thread_idx on public.posts (thread_id, created_at);

create table if not exists public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (post_id, user_id)
);

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null check (char_length(reason) between 3 and 500),
  status      text not null default 'open' check (status in ('open','resolved')),
  resolved_by uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- ---------- funkcje pomocnicze ----------
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','moderator') and not banned);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and not banned);
$$;

create or replace function public.can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and not banned);
$$;

-- ---------- automatyczny profil po rejestracji ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text;
  uname text;
  n int := 0;
  prov text := coalesce(new.raw_app_meta_data->>'provider', 'email');
begin
  base := coalesce(
    nullif(new.raw_user_meta_data->>'username', ''),
    nullif(new.raw_user_meta_data->'custom_claims'->>'global_name', ''),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    split_part(new.email, '@', 1), 'gracz');
  base := regexp_replace(base, '[^A-Za-z0-9_-]', '', 'g');
  if char_length(base) < 3 then base := 'gracz' || base; end if;
  base := left(base, 20);
  uname := base;
  while exists (select 1 from profiles where lower(username) = lower(uname)) loop
    n := n + 1; uname := base || n::text;
  end loop;
  insert into profiles (id, username, avatar_url, discord_id)
  values (
    new.id, uname,
    case when new.raw_user_meta_data->>'avatar_url' like 'https://%' then new.raw_user_meta_data->>'avatar_url' end,
    case when prov = 'discord' then new.raw_user_meta_data->>'provider_id' end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- licznik postów i aktywność ----------
create or replace function public.bump_thread() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update threads set posts_count = posts_count + 1, last_post_at = new.created_at where id = new.thread_id;
  elsif tg_op = 'DELETE' then
    update threads set posts_count = greatest(posts_count - 1, 0) where id = old.thread_id;
  end if;
  return null;
end $$;

drop trigger if exists posts_bump on public.posts;
create trigger posts_bump after insert or delete on public.posts
  for each row execute function public.bump_thread();

-- ---------- ochrona kolumn wrażliwych ----------
-- Zwykły użytkownik nie może zmienić roli, bana, ostrzeżeń ani discord_id.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;         -- service_role / SQL editor
  if public.is_admin() and new.id <> auth.uid() then return new; end if;   -- admin zmienia innych
  if public.is_staff() and new.id <> auth.uid() and old.role = 'user' and new.role = old.role then
    new.username := old.username; new.discord_id := old.discord_id; new.avatar_url := old.avatar_url;
    return new;                                          -- moderator: tylko ban i ostrzeżenia zwykłych graczy
  end if;
  if new.id = auth.uid() then
    new.role := old.role; new.banned := old.banned; new.warnings := old.warnings; new.discord_id := old.discord_id;
    return new;
  end if;
  raise exception 'row-level security: brak uprawnień';
end $$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile();

-- Zablokowany wątek: tylko staff może pisać; edycja cudzych postów tylko przez staff.
create or replace function public.guard_post() returns trigger
language plpgsql security definer set search_path = public as $$
declare l boolean;
begin
  if tg_op = 'INSERT' then
    select locked into l from threads where id = new.thread_id;
    if l and not public.is_staff() then raise exception 'row-level security: wątek zamknięty'; end if;
  elsif tg_op = 'UPDATE' then
    new.edited_at := now(); new.thread_id := old.thread_id; new.author_id := old.author_id;
  end if;
  return new;
end $$;

drop trigger if exists posts_guard on public.posts;
create trigger posts_guard before insert or update on public.posts
  for each row execute function public.guard_post();

-- Zwykły autor nie zmienia przypięcia/zamknięcia/liczników wątku.
create or replace function public.guard_thread() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_staff() then
    new.pinned := old.pinned; new.locked := old.locked; new.posts_count := old.posts_count;
    new.category_slug := old.category_slug; new.author_id := old.author_id;
  end if;
  return new;
end $$;

drop trigger if exists threads_guard on public.threads;
create trigger threads_guard before update on public.threads
  for each row execute function public.guard_thread();

-- ---------- RLS ----------
alter table public.categories enable row level security;
alter table public.profiles   enable row level security;
alter table public.threads    enable row level security;
alter table public.posts      enable row level security;
alter table public.likes      enable row level security;
alter table public.reports    enable row level security;

-- categories: odczyt dla wszystkich, zmiany tylko admin
drop policy if exists cat_read on public.categories;
create policy cat_read on public.categories for select using (true);
drop policy if exists cat_admin on public.categories;
create policy cat_admin on public.categories for all using (public.is_admin()) with check (public.is_admin());

-- profiles: publiczny odczyt (bez e-maili – te są w auth.users)
drop policy if exists prof_read on public.profiles;
create policy prof_read on public.profiles for select using (true);
drop policy if exists prof_update on public.profiles;
create policy prof_update on public.profiles for update
  using (id = auth.uid() or public.is_staff()) with check (id = auth.uid() or public.is_staff());

-- threads
drop policy if exists thr_read on public.threads;
create policy thr_read on public.threads for select using (true);
drop policy if exists thr_insert on public.threads;
create policy thr_insert on public.threads for insert with check (
  author_id = auth.uid() and public.can_write()
  and (category_slug <> 'ogloszenia' or public.is_staff())
);
drop policy if exists thr_update on public.threads;
create policy thr_update on public.threads for update
  using ((author_id = auth.uid() and public.can_write()) or public.is_staff());
drop policy if exists thr_delete on public.threads;
create policy thr_delete on public.threads for delete
  using ((author_id = auth.uid() and public.can_write()) or public.is_staff());

-- posts
drop policy if exists post_read on public.posts;
create policy post_read on public.posts for select using (true);
drop policy if exists post_insert on public.posts;
create policy post_insert on public.posts for insert with check (author_id = auth.uid() and public.can_write());
drop policy if exists post_update on public.posts;
create policy post_update on public.posts for update
  using ((author_id = auth.uid() and public.can_write()) or public.is_staff());
drop policy if exists post_delete on public.posts;
create policy post_delete on public.posts for delete
  using ((author_id = auth.uid() and public.can_write()) or public.is_staff());

-- likes
drop policy if exists like_read on public.likes;
create policy like_read on public.likes for select using (true);
drop policy if exists like_insert on public.likes;
create policy like_insert on public.likes for insert with check (user_id = auth.uid() and public.can_write());
drop policy if exists like_delete on public.likes;
create policy like_delete on public.likes for delete using (user_id = auth.uid());

-- reports: zgłaszać może każdy zalogowany, czytać i zamykać tylko staff
drop policy if exists rep_insert on public.reports;
create policy rep_insert on public.reports for insert with check (reporter_id = auth.uid() and public.can_write());
drop policy if exists rep_read on public.reports;
create policy rep_read on public.reports for select using (public.is_staff());
drop policy if exists rep_update on public.reports;
create policy rep_update on public.reports for update using (public.is_staff());

-- ---------- dane startowe: działy ----------
insert into public.categories (slug, name, description, icon, grp, sort) values
  ('ogloszenia','Ogłoszenia','Nowości, zasady i informacje od administracji.','📢','Społeczność',1),
  ('ogolne','Ogólne / Off-topic','Rozmowy o wszystkim, co nie pasuje gdzie indziej.','💬','Społeczność',2),
  ('sprzet','Sprzęt i benchmarki','GPU, CPU, recenzje komponentów i wyniki testów FPS.','🖥️','Społeczność',3),
  ('pomoc','Pomoc i zgłoszenia','Problemy z forum, serwerem Discord, pytania do moderacji.','🛠️','Społeczność',4),
  ('fh3','Forza Horizon 3','Tuning, wyścigi, zloty i porady do FH3.','🏝️','Gry',10),
  ('fh4','Forza Horizon 4','Tuning, wyścigi, zloty i porady do FH4.','🍂','Gry',11),
  ('fh5','Forza Horizon 5','Tuning, wyścigi, zloty i porady do FH5.','🌵','Gry',12),
  ('fh6','Forza Horizon 6','Wszystko o Forza Horizon 6.','🏁','Gry',13),
  ('cs2','Counter-Strike 2','Taktyki, ustawienia, skiny, szukanie składu.','🔫','Gry',14),
  ('ets2','Euro Truck Simulator 2','Trasy, mody, konwoje i ustawienia kierownic.','🚚','Gry',15),
  ('wot','World of Tanks','Czołgi, taktyki, klany i aktualizacje.','🛡️','Gry',16),
  ('heat','HEAT','Dział poświęcony grze HEAT.','🔥','Gry',17),
  ('gta5','GTA 5','Online, mody, serwery i poradniki do GTA V.','🚓','Gry',18)
on conflict (slug) do nothing;

-- ============================================================
-- PIERWSZY ADMIN: zarejestruj się na forum, potem uruchom (podmień nazwę):
--   update public.profiles set role = 'admin' where username = 'TWOJ_NICK';
-- ============================================================
