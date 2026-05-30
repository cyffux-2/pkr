import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import styles from './LocalLobbyPlayerCount.module.css';

type LocalLobbyMode = 'trio' | 'headup';

type ActiveTournamentRow = {
  tournament_name: string | null;
  players: unknown;
};

const MODE_MATCHERS: Record<LocalLobbyMode, RegExp> = {
  trio: /^triple\s+(normal|turbo)$/i,
  headup: /^head[-\s]?up\s+(normal|turbo)$/i,
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('fr-FR').format(value);
}

function getTournamentNameQueryPattern(mode: LocalLobbyMode) {
  return mode === 'headup' ? 'Head%' : 'Triple%';
}

function getTournamentPlayers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((playerId): playerId is string => typeof playerId === 'string');
}

function countLobbyPlayers(mode: LocalLobbyMode, tournaments: ActiveTournamentRow[]) {
  const matcher = MODE_MATCHERS[mode];
  const playerIds = new Set<string>();

  tournaments
    .filter(tournament => matcher.test((tournament.tournament_name ?? '').trim()))
    .forEach(tournament => {
      getTournamentPlayers(tournament.players).forEach(playerId => playerIds.add(playerId));
    });

  return playerIds.size;
}

export default function LocalLobbyPlayerCount({ mode }: { mode: LocalLobbyMode }) {
  const [playerCount, setPlayerCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadPlayerCount = async () => {
      const { data, error } = await supabase
        .from('tournaments')
        .select('tournament_name, players')
        .ilike('tournament_name', getTournamentNameQueryPattern(mode));

      if (cancelled) return;

      setPlayerCount(error ? 0 : countLobbyPlayers(mode, (data ?? []) as ActiveTournamentRow[]));
    };

    loadPlayerCount();

    const channel = supabase
      .channel(`local-${mode}-lobby-player-count`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments' },
        loadPlayerCount
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [mode]);

  return (
    <aside className={`${styles.counter} ${styles[mode]}`} aria-label="Joueurs dans le lobby">
      <span>Joueurs dans le lobby</span>
      <strong>{formatNumber(playerCount)}</strong>
    </aside>
  );
}
