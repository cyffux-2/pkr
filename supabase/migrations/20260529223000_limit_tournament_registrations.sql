create or replace function public.enforce_tournament_registration_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  checked_player_id text;
  current_registration_count integer;
  newly_registered_players text[];
begin
  if new.players is null or coalesce(array_length(new.players, 1), 0) = 0 then
    return new;
  end if;

  lock table public.tournaments in share row exclusive mode;

  select array_agg(distinct player_id)
  into newly_registered_players
  from unnest(new.players) as player_id
  where player_id is not null
    and player_id <> ''
    and (
      tg_op = 'INSERT'
      or old.players is null
      or not (player_id = any(old.players))
    );

  if newly_registered_players is null then
    return new;
  end if;

  foreach checked_player_id in array newly_registered_players loop
    select count(*)
    into current_registration_count
    from public.tournaments tournament
    where tournament.id <> new.id
      and tournament.players @> array[checked_player_id];

    if current_registration_count >= 4 then
      raise exception 'Tournament registration limit reached'
        using
          errcode = 'P0001',
          detail = checked_player_id,
          hint = 'A player cannot be registered in more than 4 tournaments at the same time.';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists enforce_tournament_registration_limit on public.tournaments;

create trigger enforce_tournament_registration_limit
before insert or update of players on public.tournaments
for each row
execute function public.enforce_tournament_registration_limit();
