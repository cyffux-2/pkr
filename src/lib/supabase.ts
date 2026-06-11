import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL!;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY!;
const supabaseProjectRef = (() => {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0] || 'local';
  } catch {
    return 'local';
  }
})();
const memoryStorage = (() => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
})();
const authStorage = (() => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Some browsers can expose localStorage while blocking access to it.
  }
  return memoryStorage;
})();
export const PKR_AUTH_STORAGE_KEY = `pkr-${supabaseProjectRef}-auth-token`;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: true,
    persistSession: true,
    storage: authStorage,
    storageKey: PKR_AUTH_STORAGE_KEY,
  },
  realtime: {
    params: {
      eventsPerSecond: 40,
    },
  },
});

export const realtimeInputSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
    storageKey: 'pkr-realtime-input-auth-token',
  },
  realtime: {
    params: {
      eventsPerSecond: 20,
    },
  },
});
