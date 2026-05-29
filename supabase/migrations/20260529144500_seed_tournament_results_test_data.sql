do $$
declare
  hero_id uuid;
  hero_name text;
  hero_elo integer;
  bot_a_id uuid;
  bot_a_name text;
  bot_a_elo integer;
  bot_b_id uuid;
  bot_b_name text;
  bot_b_elo integer;
  seed_player_count integer;
  tournament_index integer;
  seed_tournament_id bigint;
  finished_at timestamptz;
  hero_wins boolean;
  hero_placement integer;
  hero_delta integer;
begin
  select user_id::uuid, username, elo
    into hero_id, hero_name, hero_elo
  from public.profiles
  where lower(username) = 'cyffux'
  order by created_at asc
  limit 1;

  if hero_id is null then
    select user_id::uuid, username, elo
      into hero_id, hero_name, hero_elo
    from public.profiles
    order by created_at asc
    limit 1;
  end if;

  if hero_id is null then
    return;
  end if;

  select user_id::uuid, username, elo
    into bot_a_id, bot_a_name, bot_a_elo
  from public.profiles
  where lower(username) = 'bot_delta'
  limit 1;

  select user_id::uuid, username, elo
    into bot_b_id, bot_b_name, bot_b_elo
  from public.profiles
  where lower(username) = 'bot_echo'
  limit 1;

  seed_player_count := 1
    + case when bot_a_id is null then 0 else 1 end
    + case when bot_b_id is null then 0 else 1 end;

  for tournament_index in 1..20 loop
    seed_tournament_id := 900000 + tournament_index;
    finished_at := now() - ((20 - tournament_index) || ' hours')::interval;
    hero_wins := tournament_index in (1, 4, 8, 12, 16, 20);
    hero_placement := case
      when hero_wins then 1
      when tournament_index % 2 = 0 then 2
      else least(3, seed_player_count)
    end;
    hero_delta := case
      when hero_placement = 1 then 16 + (tournament_index % 7)
      when hero_placement = 2 then 2 + (tournament_index % 3)
      else -10 - (tournament_index % 5)
    end;

    insert into public.tournament_results (
      tournament_id,
      tournament_name,
      tournament_started_at,
      tournament_finished_at,
      player_id,
      player_username,
      placement,
      is_winner,
      ranked,
      player_count,
      elo_before,
      elo_after,
      elo_delta,
      chance_multiplier,
      all_in_ev_adjustment
    )
    values (
      seed_tournament_id,
      'Tournoi test #' || tournament_index,
      finished_at - interval '18 minutes',
      finished_at,
      hero_id,
      hero_name,
      hero_placement,
      hero_placement = 1,
      true,
      seed_player_count,
      hero_elo - hero_delta,
      hero_elo,
      hero_delta,
      1,
      0
    )
    on conflict (tournament_id, player_id) do update
      set tournament_name = excluded.tournament_name,
          tournament_started_at = excluded.tournament_started_at,
          tournament_finished_at = excluded.tournament_finished_at,
          player_username = excluded.player_username,
          placement = excluded.placement,
          is_winner = excluded.is_winner,
          ranked = excluded.ranked,
          player_count = excluded.player_count,
          elo_before = excluded.elo_before,
          elo_after = excluded.elo_after,
          elo_delta = excluded.elo_delta,
          chance_multiplier = excluded.chance_multiplier,
          all_in_ev_adjustment = excluded.all_in_ev_adjustment;

    if bot_a_id is not null then
      insert into public.tournament_results (
        tournament_id,
        tournament_name,
        tournament_started_at,
        tournament_finished_at,
        player_id,
        player_username,
        placement,
        is_winner,
        ranked,
        player_count,
        elo_before,
        elo_after,
        elo_delta,
        chance_multiplier,
        all_in_ev_adjustment
      )
      values (
        seed_tournament_id,
        'Tournoi test #' || tournament_index,
        finished_at - interval '18 minutes',
        finished_at,
        bot_a_id,
        bot_a_name,
        case when hero_wins then 2 else 1 end,
        not hero_wins,
        true,
        seed_player_count,
        bot_a_elo,
        bot_a_elo + case when hero_wins then -6 else 12 end,
        case when hero_wins then -6 else 12 end,
        1,
        0
      )
      on conflict (tournament_id, player_id) do update
        set tournament_name = excluded.tournament_name,
            tournament_started_at = excluded.tournament_started_at,
            tournament_finished_at = excluded.tournament_finished_at,
            player_username = excluded.player_username,
            placement = excluded.placement,
            is_winner = excluded.is_winner,
            ranked = excluded.ranked,
            player_count = excluded.player_count,
            elo_before = excluded.elo_before,
            elo_after = excluded.elo_after,
            elo_delta = excluded.elo_delta,
            chance_multiplier = excluded.chance_multiplier,
            all_in_ev_adjustment = excluded.all_in_ev_adjustment;
    end if;

    if bot_b_id is not null then
      insert into public.tournament_results (
        tournament_id,
        tournament_name,
        tournament_started_at,
        tournament_finished_at,
        player_id,
        player_username,
        placement,
        is_winner,
        ranked,
        player_count,
        elo_before,
        elo_after,
        elo_delta,
        chance_multiplier,
        all_in_ev_adjustment
      )
      values (
        seed_tournament_id,
        'Tournoi test #' || tournament_index,
        finished_at - interval '18 minutes',
        finished_at,
        bot_b_id,
        bot_b_name,
        case when hero_wins then least(3, seed_player_count) else 2 end,
        false,
        true,
        seed_player_count,
        bot_b_elo,
        bot_b_elo + case when hero_wins then -8 else -4 end,
        case when hero_wins then -8 else -4 end,
        1,
        0
      )
      on conflict (tournament_id, player_id) do update
        set tournament_name = excluded.tournament_name,
            tournament_started_at = excluded.tournament_started_at,
            tournament_finished_at = excluded.tournament_finished_at,
            player_username = excluded.player_username,
            placement = excluded.placement,
            is_winner = excluded.is_winner,
            ranked = excluded.ranked,
            player_count = excluded.player_count,
            elo_before = excluded.elo_before,
            elo_after = excluded.elo_after,
            elo_delta = excluded.elo_delta,
            chance_multiplier = excluded.chance_multiplier,
            all_in_ev_adjustment = excluded.all_in_ev_adjustment;
    end if;
  end loop;
end $$;
