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
    if (!players.includes(userId)) {
      return new Response(JSON.stringify({ tournament }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: tables, error: tableError } = await admin
      .from('poker-tables')
      .select('id, players')
      .eq('tournament', tournamentId)

    if (tableError) {
      return new Response(JSON.stringify({ error: tableError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const playerTables = (tables ?? []).filter((table) =>
      Array.isArray(table.players) && table.players.includes(userId)
    )
    const playerHasTable = playerTables.length > 0
    const tournamentStarted = new Date(tournament.start_date).getTime() <= Date.now()

    if (playerHasTable && tournamentStarted) {
      return new Response(JSON.stringify({ error: 'La désinscription est impossible après le début du tournoi.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const nextPlayers = players.filter((playerId) => playerId !== userId)
    const { data: updated, error: updateError } = await admin
      .from('tournaments')
      .update({ players: nextPlayers })
      .eq('id', tournamentId)
      .select('*')
      .single()

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    for (const table of playerTables) {
      const tablePlayers = Array.isArray(table.players) ? table.players : []
      const nextTablePlayers = tablePlayers.filter((playerId) => playerId !== userId)

      const { error: updateTableError } = await admin
        .from('poker-tables')
        .update({ players: nextTablePlayers })
        .eq('id', table.id)

      if (updateTableError) {
        return new Response(JSON.stringify({ error: updateTableError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
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
