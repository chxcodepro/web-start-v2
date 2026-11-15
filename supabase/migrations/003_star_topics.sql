alter table public.github_stars
  add column if not exists topics text[] not null default '{}';

comment on column public.github_stars.topics is
  'GitHub repository topics copied during synchronization; used as a signal for AI grouping.';
