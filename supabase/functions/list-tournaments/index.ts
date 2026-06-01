// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const registrationClosedAfterLevel = 10

function getCurrentLevel(tournament) {
  const startTime = new Date(tournament.start_date).getTime()
  const levelMinutes = Number(tournament.time_per_level)

  if (!Number.isFinite(startTime) || !Number.isFinite(levelMinutes) || levelMinutes <= 0) {
    return 0
  }

  const elapsedMs = Date.now() - startTime
  if (elapsedMs < 0) return 0

  return Math.floor(elapsedMs / (levelMinutes * 60_000)) + 1
}

function isRegistrationClosed(tournament) {
  if (Number(tournament.max_players) < 20) return false
  return getCurrentLevel(tournament) > registrationClosedAfterLevel
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

    const nowIso = new Date().toISOString()
    const [scheduledResponse, sitAndGoResponse] = await Promise.all([
      admin
        .from('tournaments')
        .select('*')
        .gte('start_date', nowIso)
        .order('start_date', { ascending: true })
        .limit(50),
      admin
        .from('tournaments')
        .select('*')
        .lt('max_players', 20)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    if (scheduledResponse.error) {
      return new Response(JSON.stringify({ error: scheduledResponse.error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (sitAndGoResponse.error) {
      return new Response(JSON.stringify({ error: sitAndGoResponse.error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const tournamentsById = new Map()
    for (const tournament of scheduledResponse.data ?? []) {
      tournamentsById.set(tournament.id, tournament)
    }
    for (const tournament of sitAndGoResponse.data ?? []) {
      tournamentsById.set(tournament.id, tournament)
    }

    const tournaments = Array.from(tournamentsById.values())
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
      const currentLevel = getCurrentLevel(tournament)

      return {
        ...tournament,
        alive_players_count: alivePlayers,
        current_level: currentLevel,
        registration_closed: isRegistrationClosed(tournament),
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
