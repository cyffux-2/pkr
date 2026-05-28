// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  try {
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data, error } = await admin
      .from('tournaments')
      .select('*')
      .order('start_date', { ascending: false })
      .limit(50)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const tournaments = data ?? []
    const tournamentIds = tournaments
      .map((tournament) => tournament.id)
      .filter((id) => typeof id === 'number')

    const aliveCountByTournament = new Map()
    if (tournamentIds.length > 0) {
      const { data: tables, error: tableError } = await admin
        .from('poker-tables')
        .select('tournament, players')
        .in('tournament', tournamentIds)

      if (tableError) {
        return new Response(JSON.stringify({ error: tableError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      for (const table of tables ?? []) {
        const tournamentId = table.tournament
        if (typeof tournamentId !== 'number') continue
        const players = Array.isArray(table.players) ? table.players : []
        const current = aliveCountByTournament.get(tournamentId) ?? new Set()
        for (const playerId of players) {
          if (typeof playerId === 'string') current.add(playerId)
        }
        aliveCountByTournament.set(tournamentId, current)
      }
    }

    const enrichedTournaments = tournaments.map((tournament) => {
      const registeredPlayers = Array.isArray(tournament.players) ? tournament.players.length : 0
      const alivePlayers = aliveCountByTournament.has(tournament.id)
        ? aliveCountByTournament.get(tournament.id).size
        : registeredPlayers

      return {
        ...tournament,
        alive_players_count: alivePlayers,
      }
    })

    return new Response(JSON.stringify({ tournaments: enrichedTournaments }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message ?? 'unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
