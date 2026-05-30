// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const maxActiveTournaments = 4
const registrationLimitError = `Tu ne peux pas rejoindre plus de ${maxActiveTournaments} tournois en simultané.`

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
