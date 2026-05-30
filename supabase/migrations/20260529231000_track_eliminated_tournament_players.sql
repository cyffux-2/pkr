create table if not exists public.tournament_eliminations (
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  player_id uuid not null,
  eliminated_at timestamp with time zone not null default now(),
  placement integer,
  primary key (tournament_id, player_id)
);

create or replace function public.count_active_tournament_registrations(
  target_player_id uuid,
  excluded_tournament_id bigint default null
)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
  from public.tournaments tournament
  where (excluded_tournament_id is null or tournament.id <> excluded_tournament_id)
    and tournament.players @> array[target_player_id]
    and not exists (
      select 1
      from public.tournament_eliminations elimination
      where elimination.tournament_id = tournament.id
        and elimination.player_id = target_player_id
    );
$$;

create or replace function public.enforce_tournament_registration_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  checked_player_id uuid;
  current_registration_count integer;
  newly_registered_players uuid[];
begin
  if new.players is null or coalesce(array_length(new.players, 1), 0) = 0 then
    return new;
  end if;

  lock table public.tournaments in share row exclusive mode;

  select array_agg(distinct player_id)
  into newly_registered_players
  from unnest(new.players) as player_id
  where player_id is not null
    and (
      tg_op = 'INSERT'
      or old.players is null
      or not (player_id = any(old.players))
    );

  if newly_registered_players is null then
    return new;
  end if;

  foreach checked_player_id in array newly_registered_players loop
    current_registration_count := public.count_active_tournament_registrations(checked_player_id, new.id);

    if current_registration_count >= 4 then
      raise exception 'Tournament registration limit reached'
        using
          errcode = 'P0001',
          detail = checked_player_id::text,
          hint = 'A player cannot be registered in more than 4 active tournaments at the same time.';
    end if;
  end loop;

  return new;
end;
$$;
