create or replace function public.count_weekly_profile_registrations()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.profiles
  where created_at >= (
    date_trunc('week', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'
  );
$$;

revoke all on function public.count_weekly_profile_registrations() from public;
grant execute on function public.count_weekly_profile_registrations() to anon, authenticated;
