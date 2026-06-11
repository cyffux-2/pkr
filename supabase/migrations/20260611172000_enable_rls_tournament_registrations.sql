alter table public.tournament_registrations enable row level security;

drop policy if exists "Users can read their own tournament registrations"
  on public.tournament_registrations;

create policy "Users can read their own tournament registrations"
  on public.tournament_registrations
  for select
  to authenticated
  using (player_id = auth.uid());
