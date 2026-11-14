-- Accounts for MvC2Online: one profile per auth user, plus their friends list.
--
-- Applied to project jjtfnduodxtulxvviasf. Re-runnable: every object is
-- guarded, so this doubles as the record of what the live database has.
--
-- Access model: profiles are readable by any signed-in user (the friends list
-- needs to resolve names), writable only by their owner; friends rows are
-- entirely owner-scoped. Anonymous visitors can write nothing.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null default 'Player',
  avatar text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
grant select, insert, update on public.profiles to authenticated;

drop policy if exists "profiles readable by signed in users" on public.profiles;
create policy "profiles readable by signed in users" on public.profiles
  for select to authenticated using (true);

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- friend_id is text because a friend may be a signed-out session key rather
-- than an account uuid; account-keyed presence makes the usual case a uuid.
create table if not exists public.friends (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id text not null,
  friend_name text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

alter table public.friends enable row level security;
grant select, insert, delete on public.friends to authenticated;

drop policy if exists "read own friends" on public.friends;
create policy "read own friends" on public.friends
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "add own friends" on public.friends;
create policy "add own friends" on public.friends
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "remove own friends" on public.friends;
create policy "remove own friends" on public.friends
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists friends_user_idx on public.friends (user_id);
