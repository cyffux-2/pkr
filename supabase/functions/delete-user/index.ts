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

  console.log('SUPABASE_URL set:', !!url)
  console.log('SERVICE_ROLE_KEY set:', !!serviceKey)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace('Bearer ', '')

    console.log('JWT received:', jwt.length > 0)

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const { data, error: getUserError } = await admin.auth.getUser(jwt)
    console.log('getUser error:', getUserError?.message ?? 'none')
    console.log('user id:', data?.user?.id ?? 'null')

    if (getUserError || !data?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: profileDeleteError } = await admin
      .from('profiles')
      .delete()
      .eq('user_id', data.user.id)
    console.log('delete profile error:', profileDeleteError?.message ?? 'none')

    if (profileDeleteError) {
      return new Response(JSON.stringify({ error: profileDeleteError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id)
    console.log('deleteUser error:', deleteError?.message ?? 'none')

    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    console.error('Caught exception:', e?.message)
    return new Response(JSON.stringify({ error: e?.message ?? 'unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
