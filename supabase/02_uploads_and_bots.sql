-- ============================================================
-- REDLINE ARENA – część 2: załączniki (pliki, zdjęcia) i boty
-- Uruchom PO schema.sql: Supabase -> SQL Editor -> New query -> Run
-- Skrypt jest bezpieczny do wielokrotnego uruchamiania.
-- ============================================================

-- ---------- załączniki w postach ----------
alter table public.posts add column if not exists attachments jsonb not null default '[]'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'posts_attachments_chk') then
    alter table public.posts add constraint posts_attachments_chk
      check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5);
  end if;
end $$;

-- ---------- oznaczenie kont botów ----------
alter table public.profiles add column if not exists is_bot boolean not null default false;

-- ---------- bucket na pliki (publiczny odczyt, limit 10 MB, lista dozwolonych typów) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', true, 10485760, array[
  'image/png','image/jpeg','image/gif','image/webp',
  'application/pdf','text/plain','application/json','text/csv',
  'application/zip','application/x-zip-compressed','application/x-7z-compressed',
  'application/vnd.rar','application/x-rar-compressed',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'video/mp4','video/webm'
])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Wgrywać może zalogowany, niezablokowany użytkownik – tylko do własnego folderu <user_id>/...
drop policy if exists att_insert on storage.objects;
create policy att_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.can_write()
  );

-- Usuwać może właściciel pliku albo staff.
drop policy if exists att_delete on storage.objects;
create policy att_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff())
  );

-- ---------- walidacja załączników w postach ----------
-- Ścieżka pliku musi wskazywać folder autora posta, a obiekt nie może zawierać pola "data"
-- (pole używane tylko w trybie demo) – zapobiega podstawianiu cudzych/niebezpiecznych adresów.
create or replace function public.guard_post() returns trigger
language plpgsql security definer set search_path = public as $$
declare l boolean;
begin
  if jsonb_array_length(new.attachments) > 0 and exists (
    select 1 from jsonb_array_elements(new.attachments) a
    where coalesce(a->>'path', '') !~ ('^' || new.author_id::text || '/[A-Za-z0-9._-]+$')
       or jsonb_exists(a, 'data')
  ) then
    raise exception 'niepoprawny załącznik';
  end if;

  if tg_op = 'INSERT' then
    select locked into l from threads where id = new.thread_id;
    if l and not public.is_staff() then raise exception 'row-level security: wątek zamknięty'; end if;
  elsif tg_op = 'UPDATE' then
    new.edited_at := now(); new.thread_id := old.thread_id; new.author_id := old.author_id;
  end if;
  return new;
end $$;

-- ---------- ochrona profilu: dodatkowo is_bot ----------
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.is_admin() and new.id <> auth.uid() then return new; end if;
  if public.is_staff() and new.id <> auth.uid() and old.role = 'user' and new.role = old.role then
    new.username := old.username; new.discord_id := old.discord_id; new.avatar_url := old.avatar_url;
    new.is_bot := old.is_bot;
    return new;
  end if;
  if new.id = auth.uid() then
    new.role := old.role; new.banned := old.banned; new.warnings := old.warnings;
    new.discord_id := old.discord_id; new.is_bot := old.is_bot;
    return new;
  end if;
  raise exception 'row-level security: brak uprawnień';
end $$;

-- ---------- boty ----------
-- Token bota jest przechowywany WYŁĄCZNIE jako skrót SHA-256. Tabela nie ma żadnych polityk RLS,
-- więc przeglądarka (klucz anon / zalogowany użytkownik) nie ma do niej dostępu –
-- korzystają z niej tylko funkcje Netlify z kluczem service_role.
create table if not exists public.bots (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null unique references public.profiles(id) on delete cascade,
  token_hash         text not null unique,
  allowed_categories text[] not null default '{}',   -- pusta tablica = wszystkie działy
  active             boolean not null default true,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz
);
alter table public.bots enable row level security;
