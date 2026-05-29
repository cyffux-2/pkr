create table if not exists public.tournament_results (
  id bigserial primary key,
  tournament_id bigint not null,
  tournament_name text not null,
  tournament_started_at timestamptz,
  tournament_finished_at timestamptz not null default now(),
  player_id uuid not null,
  player_username text not null,
  placement integer not null,
  is_winner boolean not null default false,
  ranked boolean not null default true,
  player_count integer not null,
  elo_before integer not null default 0,
  elo_after integer not null default 0,
  elo_delta integer not null default 0,
  chance_multiplier numeric,
  all_in_ev_adjustment numeric,
  created_at timestamptz not null default now(),
  constraint tournament_results_unique_player unique (tournament_id, player_id),
  constraint tournament_results_placement_positive check (placement > 0),
  constraint tournament_results_player_count_positive check (player_count > 0)
);

create index if not exists tournament_results_player_finished_idx
  on public.tournament_results (player_id, tournament_finished_at desc);

create index if not exists tournament_results_tournament_idx
  on public.tournament_results (tournament_id, placement);

alter table public.tournament_results enable row level security;

drop policy if exists "Authenticated users can read tournament results" on public.tournament_results;

create policy "Authenticated users can read tournament results"
  on public.tournament_results
  for select
  to authenticated
  using (true);
