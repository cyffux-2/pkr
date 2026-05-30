// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const maxActiveTournaments = 4
const registrationLimitError = `Tu ne peux pas rejoindre plus de ${maxActiveTournaments} tournois en simultané.`

const headupConfigs = {
  normal: {
    name: 'HeadUp Normal',
    timePerLevel: 1.5,
    legacyTimePerLevel: 2,
  },
  turbo: {
    name: 'HeadUp Turbo',
    timePerLevel: 1,
    legacyTimePerLevel: 1,
  },
}

async function createTournament(admin, config, timePerLevel) {
  return admin
    .from('tournaments')
    .insert({
      tournament_name: config.name,
      start_date: new Date().toISOString(),
      max_players: 2,
      min_players: 2,
      players: [],
      ranked: true,
      time_per_level: timePerLevel,
    })
    .select('*')
    .single()
}

async function countActiveTournamentsForUser(admin, userId) {
  const { data, error } = await admin.rpc('count_active_tournament_registrations', {
    target_player_id: userId,
  })

  if (error) throw error
  return Number(data ?? 0)
}

async function getEliminatedTournamentIdsForUser(admin, tournamentIds, userId) {
  if (tournamentIds.length === 0) return new Set()

  const { data, error } = await admin
    .from('tournament_eliminations')
    .select('tournament_id')
    .eq('player_id', userId)
    .in('tournament_id', tournamentIds)

  if (error) throw error
  return new Set((data ?? []).map(row => Number(row.tournament_id)))
}

function normalizeJoinError(error) {
  const message = error?.message ?? ''
  return message.includes('Tournament registration limit reached')
    ? registrationLimitError
    : message || 'Tournament join failed'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace('Bearer ', '')

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: userData, error: getUserError } = await admin.auth.getUser(jwt)
    if (getUserError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { variant } = await req.json()
    const config = headupConfigs[variant]
    if (!config) {
      return new Response(JSON.stringify({ error: 'Invalid headup variant' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userId = userData.user.id
    const { data: candidates, error: fetchError } = await admin
      .from('tournaments')
      .select('*')
      .eq('tournament_name', config.name)
      .eq('max_players', 2)
      .eq('min_players', 2)
      .order('created_at', { ascending: true })
      .limit(25)

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const candidateIds = (candidates ?? []).map(candidate => candidate.id)
    const eliminatedTournamentIds = await getEliminatedTournamentIdsForUser(admin, candidateIds, userId)

    let tournament = (candidates ?? []).find((candidate) => {
      const players = Array.isArray(candidate.players) ? candidate.players : []
      const expectedLevels = new Set([config.timePerLevel, config.legacyTimePerLevel])
      if (!expectedLevels.has(Number(candidate.time_per_level))) return false
      if (players.includes(userId)) return !eliminatedTournamentIds.has(candidate.id)
      return players.length < 2
    })

    if (!tournament) {
      const activeTournamentCount = await countActiveTournamentsForUser(admin, userId)
      if (activeTournamentCount >= maxActiveTournaments) {
        return new Response(JSON.stringify({ error: registrationLimitError }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      let { data: created, error: createError } = await createTournament(admin, config, config.timePerLevel)

      if (createError && config.legacyTimePerLevel !== config.timePerLevel) {
        const fallback = await createTournament(admin, config, config.legacyTimePerLevel)
        created = fallback.data
        createError = fallback.error
      }

      if (createError || !created) {
        return new Response(JSON.stringify({ error: createError?.message ?? 'Tournament creation failed' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      tournament = created
    }

    const players = Array.isArray(tournament.players) ? tournament.players : []
    if (players.includes(userId)) {
      const activeRegistration = !eliminatedTournamentIds.has(tournament.id)
      return new Response(JSON.stringify(activeRegistration ? { tournament } : { error: 'Tu as déjà été éliminé de ce tournoi.' }), {
        status: activeRegistration ? 200 : 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const activeTournamentCount = await countActiveTournamentsForUser(admin, userId)
    if (activeTournamentCount >= maxActiveTournaments) {
      return new Response(JSON.stringify({ error: registrationLimitError }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (players.length >= 2) {
      return new Response(JSON.stringify({ error: 'Tournament is full' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: updated, error: updateError } = await admin
      .from('tournaments')
      .update({ players: [...players, userId] })
      .eq('id', tournament.id)
      .select('*')
      .single()

    if (updateError || !updated) {
      return new Response(JSON.stringify({ error: normalizeJoinError(updateError) }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ tournament: updated }), {
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
