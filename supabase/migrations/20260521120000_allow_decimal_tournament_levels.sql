alter table public.tournaments
  alter column time_per_level type double precision
  using time_per_level::double precision;
