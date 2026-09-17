create extension if not exists pgcrypto;

create type public.group_kind as enum ('bookmark', 'github');

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  kind public.group_kind not null,
  name text not null check (char_length(name) between 1 and 40),
  sort_order integer not null default 0,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  url text not null check (url ~ '^https?://'),
  description text,
  favicon_url text,
  tags text[] not null default '{}',
  sort_order integer not null default 0,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.github_stars (
  id uuid primary key default gen_random_uuid(),
  github_repo_id bigint not null unique,
  group_id uuid references public.groups(id) on delete set null,
  full_name text not null,
  display_name text constraint github_stars_display_name_length check (display_name is null or char_length(display_name) between 1 and 80),
  html_url text not null,
  description text,
  language text,
  stars_count integer not null default 0,
  owner_avatar_url text,
  tags text[] not null default '{}',
  note text,
  sort_order integer not null default 0,
  is_public boolean not null default true,
  is_active boolean not null default true,
  starred_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index groups_kind_order_idx on public.groups(kind, sort_order);
create index bookmarks_group_order_idx on public.bookmarks(group_id, sort_order);
create index github_stars_group_order_idx on public.github_stars(group_id, sort_order) where is_active = true;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger groups_updated_at before update on public.groups for each row execute function public.set_updated_at();
create trigger bookmarks_updated_at before update on public.bookmarks for each row execute function public.set_updated_at();
create trigger github_stars_updated_at before update on public.github_stars for each row execute function public.set_updated_at();

alter table public.groups enable row level security;
alter table public.bookmarks enable row level security;
alter table public.github_stars enable row level security;

-- The browser never accesses Supabase directly. No anon/authenticated policies are
-- created; all reads and writes go through server-only code with the service role.

insert into public.groups (kind, name, sort_order, is_public) values
  ('bookmark', '日常使用', 0, true),
  ('github', '开发工具', 0, true);
