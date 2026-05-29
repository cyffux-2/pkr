alter table public.tournament_results
  add column if not exists players jsonb not null default '[]'::jsonb,
  add column if not exists winner_ids uuid[] not null default '{}'::uuid[],
  add column if not exists total_elo_delta integer not null default 0;

alter table public.tournament_results
  alter column player_id drop not null,
  alter column player_username drop not null,
  alter column placement drop not null;

with legacy_rows as (
  select *
  from public.tournament_results
  where player_id is not null
    and jsonb_array_length(players) = 0
),
grouped_results as (
  select
    tournament_id,
    min(id) as keep_id,
    (array_agg(tournament_name order by id asc))[1] as tournament_name_value,
    min(tournament_started_at) as tournament_started_at_value,
    max(tournament_finished_at) as tournament_finished_at_value,
    bool_or(ranked) as ranked_value,
    max(player_count) as player_count_value,
    coalesce(sum(elo_delta), 0)::integer as total_elo_delta_value,
    coalesce(
      array_agg(player_id order by placement asc nulls last, id asc) filter (where is_winner),
      '{}'::uuid[]
    ) as winner_ids_value,
    jsonb_agg(
      jsonb_build_object(
        'playerId', player_id::text,
        'username', player_username,
        'placement', placement,
        'playerCount', player_count,
        'isWinner', is_winner,
        'eloBefore', elo_before,
        'eloAfter', elo_after,
        'eloDelta', elo_delta,
        'chanceMultiplier', chance_multiplier,
        'allInEvAdjustment', all_in_ev_adjustment
      )
      order by placement asc nulls last, id asc
    ) as players_value
  from legacy_rows
  group by tournament_id
)
update public.tournament_results target
set tournament_name = grouped_results.tournament_name_value,
    tournament_started_at = grouped_results.tournament_started_at_value,
    tournament_finished_at = grouped_results.tournament_finished_at_value,
    ranked = grouped_results.ranked_value,
    player_count = grouped_results.player_count_value,
    players = grouped_results.players_value,
    winner_ids = grouped_results.winner_ids_value,
    total_elo_delta = grouped_results.total_elo_delta_value,
    player_id = null,
    player_username = null,
    placement = null,
    is_winner = false,
    elo_before = 0,
    elo_after = 0,
    elo_delta = grouped_results.total_elo_delta_value,
    chance_multiplier = null,
    all_in_ev_adjustment = null
from grouped_results
where target.id = grouped_results.keep_id;

with grouped_results as (
  select tournament_id, min(id) as keep_id
  from public.tournament_results
  group by tournament_id
)
delete from public.tournament_results target
using grouped_results
where target.tournament_id = grouped_results.tournament_id
  and target.id <> grouped_results.keep_id;

alter table public.tournament_results
  drop constraint if exists tournament_results_unique_player;

create unique index if not exists tournament_results_unique_tournament_idx
  on public.tournament_results (tournament_id);

create index if not exists tournament_results_players_gin_idx
  on public.tournament_results using gin (players);
