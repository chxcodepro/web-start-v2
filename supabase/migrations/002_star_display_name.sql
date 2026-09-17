alter table public.github_stars
  add column if not exists display_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'github_stars_display_name_length'
  ) then
    alter table public.github_stars
      add constraint github_stars_display_name_length
      check (display_name is null or char_length(display_name) between 1 and 80);
  end if;
end
$$;

comment on column public.github_stars.display_name is
  'Owner-defined display name. GitHub synchronization must not overwrite this value.';
