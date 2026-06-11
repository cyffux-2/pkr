create table if not exists public.tournament_registrations (
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  player_id uuid not null,
  registered_at timestamp with time zone not null default now(),
  primary key (tournament_id, player_id)
);

insert into public.tournament_registrations (tournament_id, player_id, registered_at)
select tournament.id, player_id, now()
from public.tournaments tournament
cross join unnest(coalesce(tournament.players, array[]::uuid[])) as player_id
on conflict (tournament_id, player_id) do nothing;

create or replace function public.sync_tournament_registration_times()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.tournament_registrations (tournament_id, player_id, registered_at)
    select new.id, player_id, now()
    from unnest(coalesce(new.players, array[]::uuid[])) as player_id
    where player_id is not null
    on conflict (tournament_id, player_id) do nothing;
  else
    insert into public.tournament_registrations (tournament_id, player_id, registered_at)
    select new.id, player_id, now()
    from unnest(coalesce(new.players, array[]::uuid[])) as player_id
    where player_id is not null
      and (
        old.players is null
        or not (player_id = any(old.players))
      )
    on conflict (tournament_id, player_id) do nothing;

    delete from public.tournament_registrations registration
    where registration.tournament_id = new.id
      and not (registration.player_id = any(coalesce(new.players, array[]::uuid[])));
  end if;

  return new;
end;
$$;

drop trigger if exists sync_tournament_registration_times on public.tournaments;

create trigger sync_tournament_registration_times
after insert or update of players on public.tournaments
for each row
execute function public.sync_tournament_registration_times();

create or replace function public.expire_stale_sit_and_go_registrations(
  max_age interval default interval '30 minutes'
)
returns table(tournament_id bigint, player_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  create temporary table expired_sit_and_go_registrations
  on commit drop
  as
  select registration.tournament_id, registration.player_id
  from public.tournament_registrations registration
  join public.tournaments tournament on tournament.id = registration.tournament_id
  where tournament.max_players < 20
    and coalesce(array_length(tournament.players, 1), 0) < tournament.max_players
    and tournament.players @> array[registration.player_id]
    and registration.registered_at <= now() - max_age;

  update public.tournaments tournament
  set players = coalesce(
    (
      select array_agg(registered_player.player_id order by registered_player.ordinality)
      from unnest(coalesce(tournament.players, array[]::uuid[])) with ordinality as registered_player(player_id, ordinality)
      where not exists (
        select 1
        from expired_sit_and_go_registrations expired
        where expired.tournament_id = tournament.id
          and expired.player_id = registered_player.player_id
      )
    ),
    array[]::uuid[]
  )
  where exists (
    select 1
    from expired_sit_and_go_registrations expired
    where expired.tournament_id = tournament.id
  );

  update public."poker-tables" poker_table
  set players = coalesce(
    (
      select array_agg(table_player.player_id order by table_player.ordinality)
      from unnest(coalesce(poker_table.players, array[]::uuid[])) with ordinality as table_player(player_id, ordinality)
      where not exists (
        select 1
        from expired_sit_and_go_registrations expired
        where expired.tournament_id = poker_table.tournament
          and expired.player_id = table_player.player_id
      )
    ),
    array[]::uuid[]
  )
  where poker_table.players is not null
    and exists (
      select 1
      from expired_sit_and_go_registrations expired
      where expired.tournament_id = poker_table.tournament
    );

  delete from public."poker-tables" poker_table
  where coalesce(array_length(poker_table.players, 1), 0) = 0
    and poker_table.players is not null
    and exists (
      select 1
      from expired_sit_and_go_registrations expired
      where expired.tournament_id = poker_table.tournament
    );

  delete from public.tournament_registrations registration
  using expired_sit_and_go_registrations expired
  where registration.tournament_id = expired.tournament_id
    and registration.player_id = expired.player_id;

  return query
  select expired.tournament_id, expired.player_id
  from expired_sit_and_go_registrations expired;
end;
$$;

revoke all on function public.expire_stale_sit_and_go_registrations(interval) from public;
grant execute on function public.expire_stale_sit_and_go_registrations(interval) to service_role;
