// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const maxActiveTournaments = 4
const registrationClosedAfterLevel = 10
const registrationLimitError = `Tu ne peux pas rejoindre plus de ${maxActiveTournaments} tournois en simultané.`
const registrationClosedError = `Les inscriptions sont fermées après le niveau ${registrationClosedAfterLevel}.`

async function countActiveTournamentsForUser(admin, userId) {
  const { data, error } = await admin.rpc('count_active_tournament_registrations', {
    target_player_id: userId,
  })

  if (error) throw error
  return Number(data ?? 0)
}

async function isActiveTournamentRegistration(admin, tournamentId, userId) {
  const { data, error } = await admin
    .from('tournament_eliminations')
    .select('tournament_id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', userId)
    .maybeSingle()

  if (error) throw error
  return !data
}

function normalizeJoinError(error) {
  const message = error?.message ?? ''
  if (message.includes('Tournament registration limit reached')) return registrationLimitError
  if (
    message.includes('Tournament registration closed after level 10') ||
    message.includes('Les inscriptions sont fermées après le niveau 10')
  ) return registrationClosedError
  return message || 'Tournament join failed'
}

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

    const { tournamentId } = await req.json()
    if (typeof tournamentId !== 'number') {
      return new Response(JSON.stringify({ error: 'Invalid tournament id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: tournament, error: fetchError } = await admin
      .from('tournaments')
      .select('*')
      .eq('id', tournamentId)
      .single()

    if (fetchError || !tournament) {
      return new Response(JSON.stringify({ error: fetchError?.message ?? 'Tournament not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const players = Array.isArray(tournament.players) ? tournament.players : []
    const userId = userData.user.id
    if (players.includes(userId)) {
      const activeRegistration = await isActiveTournamentRegistration(admin, tournament.id, userId)
      return new Response(JSON.stringify(activeRegistration ? { tournament } : { error: 'Tu as déjà été éliminé de ce tournoi.' }), {
        status: activeRegistration ? 200 : 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (isRegistrationClosed(tournament)) {
      return new Response(JSON.stringify({ error: registrationClosedError }), {
        status: 409,
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

    if (players.length >= tournament.max_players) {
      return new Response(JSON.stringify({ error: 'Tournament is full' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const nextPlayers = [...players, userId]
    const { data: updated, error: updateError } = await admin
      .from('tournaments')
      .update({ players: nextPlayers })
      .eq('id', tournamentId)
      .select('*')
      .single()

    if (updateError) {
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
