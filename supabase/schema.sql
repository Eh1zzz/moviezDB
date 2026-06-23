-- ============================================================================
-- MoviezDB — Supabase schema
-- Run once in your project:  Dashboard → SQL Editor → paste → Run.
-- Adds: profiles, ratings, reviews, discussions  (+ Row-Level Security).
-- ============================================================================

-- ── PROFILES ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Movie Fan',
  avatar_emoji text not null default '🎬',
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles readable by everyone" on public.profiles;
create policy "profiles readable by everyone"
  on public.profiles for select using (true);

drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Auto-create a profile row whenever a new user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── RATINGS (one star-rating per user per title) ─────────────────────────────
create table if not exists public.ratings (
  user_id    uuid not null references auth.users(id) on delete cascade,
  tmdb_id    integer not null,
  media_type text not null check (media_type in ('movie','tv')),
  rating     smallint not null check (rating between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (user_id, tmdb_id, media_type)
);
alter table public.ratings enable row level security;

drop policy if exists "ratings readable by everyone" on public.ratings;
create policy "ratings readable by everyone" on public.ratings for select using (true);

drop policy if exists "users manage own ratings" on public.ratings;
create policy "users manage own ratings" on public.ratings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── REVIEWS (one text review per user per title) ─────────────────────────────
create table if not exists public.reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  tmdb_id    integer not null,
  media_type text not null check (media_type in ('movie','tv')),
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  unique (user_id, tmdb_id, media_type)
);
alter table public.reviews enable row level security;

drop policy if exists "reviews readable by everyone" on public.reviews;
create policy "reviews readable by everyone" on public.reviews for select using (true);

drop policy if exists "users manage own reviews" on public.reviews;
create policy "users manage own reviews" on public.reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── DISCUSSIONS (per-title comment threads) ──────────────────────────────────
create table if not exists public.discussions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  tmdb_id    integer not null,
  media_type text not null check (media_type in ('movie','tv')),
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.discussions enable row level security;

drop policy if exists "discussions readable by everyone" on public.discussions;
create policy "discussions readable by everyone" on public.discussions for select using (true);

drop policy if exists "users post discussions" on public.discussions;
create policy "users post discussions" on public.discussions
  for insert with check (auth.uid() = user_id);

drop policy if exists "users delete own discussions" on public.discussions;
create policy "users delete own discussions" on public.discussions
  for delete using (auth.uid() = user_id);

-- ── Indexes for the per-title lookups ────────────────────────────────────────
create index if not exists idx_ratings_title     on public.ratings     (tmdb_id, media_type);
create index if not exists idx_reviews_title      on public.reviews     (tmdb_id, media_type);
create index if not exists idx_discussions_title  on public.discussions (tmdb_id, media_type, created_at);
