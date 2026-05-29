drop index if exists tournament_results_player_finished_idx;
drop index if exists tournament_results_tournament_idx;

alter table public.tournament_results
  drop constraint if exists tournament_results_placement_positive;

alter table public.tournament_results
  add column elo_delta_values integer[] not null default '{}'::integer[];

update public.tournament_results result
set elo_delta_values = coalesce(
  (
    select array_agg(coalesce((player_entry.player_data->>'eloDelta')::integer, 0) order by player_entry.position)
    from jsonb_array_elements(result.players) with ordinality as player_entry(player_data, position)
  ),
  '{}'::integer[]
);

update public.tournament_results result
set players = coalesce(
  (
    select jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'playerId', player_entry.player_data->>'playerId',
          'username', player_entry.player_data->>'username',
          'placement', (player_entry.player_data->>'placement')::integer,
          'isWinner', coalesce((player_entry.player_data->>'isWinner')::boolean, false)
        )
      )
      order by player_entry.position
    )
    from jsonb_array_elements(result.players) with ordinality as player_entry(player_data, position)
  ),
  '[]'::jsonb
);

alter table public.tournament_results
  drop column if exists player_id,
  drop column if exists player_username,
  drop column if exists placement,
  drop column if exists is_winner,
  drop column if exists elo_before,
  drop column if exists elo_after,
  drop column if exists chance_multiplier,
  drop column if exists all_in_ev_adjustment,
  drop column if exists total_elo_delta,
  drop column if exists elo_delta;

alter table public.tournament_results
  rename column elo_delta_values to elo_delta;
