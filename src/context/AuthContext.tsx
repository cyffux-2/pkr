import { createContext, useCallback, useContext, useRef, useState, useEffect, type ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { PKR_AUTH_STORAGE_KEY, supabase } from '../lib/supabase';

export interface UserProfile {
  user_id: string;
  username: string | null;
  tag: string | null;
  elo: number;
  avatar_url: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  getValidSession: () => Promise<Session | null>;
  syncAuthSession: (nextSession?: Session | null) => Promise<Session | null>;
  refreshProfile: () => Promise<UserProfile | null>;
  updateCachedProfile: (updates: Partial<UserProfile>) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);
const PROFILE_SELECT = 'user_id, username, tag, elo, avatar_url';

function getProfileCacheKey(userId: string) {
  return `pkr-profile-${userId}`;
}

function readCachedProfile(userId: string) {
  try {
    const rawProfile = window.sessionStorage.getItem(getProfileCacheKey(userId));
    if (!rawProfile) return null;

    const profile = JSON.parse(rawProfile) as UserProfile;
    return profile?.user_id === userId ? profile : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: UserProfile | null, userId: string) {
  try {
    const key = getProfileCacheKey(userId);
    if (profile) {
      window.sessionStorage.setItem(key, JSON.stringify(profile));
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Le cache est un confort UI : si sessionStorage est indisponible, l'app continue.
  }
}

function writeStoredSession(nextSession: Session | null) {
  try {
    if (nextSession) {
      window.localStorage.setItem(PKR_AUTH_STORAGE_KEY, JSON.stringify(nextSession));
    } else {
      window.localStorage.removeItem(PKR_AUTH_STORAGE_KEY);
    }
  } catch {
    // If localStorage is unavailable, the in-memory auth context still carries the session.
  }
}

function readStoredSession() {
  try {
    const rawSession = window.localStorage.getItem(PKR_AUTH_STORAGE_KEY);
    return rawSession ? JSON.parse(rawSession) as Session : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const userId = user?.id ?? null;

  const applySession = useCallback((nextSession: Session | null, options?: { allowClear?: boolean }) => {
    if (!nextSession && options?.allowClear === false && sessionRef.current) {
      setLoading(false);
      return;
    }

    sessionRef.current = nextSession;
    writeStoredSession(nextSession);
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    setLoading(false);
  }, []);

  const syncAuthSession = useCallback(async (nextSession?: Session | null) => {
    if (nextSession !== undefined) {
      applySession(nextSession, { allowClear: false });
      return nextSession;
    }

    const storedSession = readStoredSession();
    if (storedSession?.access_token) {
      applySession(storedSession, { allowClear: false });
      return storedSession;
    }

    const { data: currentData } = await supabase.auth.getSession();
    applySession(currentData.session, { allowClear: false });
    return currentData.session;
  }, [applySession]);

  const getValidSession = useCallback(async () => {
    const isUsableSession = (candidate: Session | null) => {
      return Boolean(candidate?.access_token);
    };

    if (isUsableSession(session)) return session;

    const storedSession = readStoredSession();
    if (isUsableSession(storedSession)) {
      applySession(storedSession, { allowClear: false });
      return storedSession;
    }

    const { data: currentData } = await supabase.auth.getSession();
    if (isUsableSession(currentData.session)) return currentData.session;

    return null;
  }, [applySession, session]);

  useEffect(() => {
    const storedSession = readStoredSession();
    if (storedSession?.access_token) {
      applySession(storedSession, { allowClear: false });
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        applySession(session, { allowClear: false });
      });
    }
  }, [applySession]);

  const refreshProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setProfileLoading(false);
      return null;
    }

    setProfileLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_SELECT)
      .eq('user_id', userId)
      .maybeSingle();

    setProfileLoading(false);
    if (error) return null;

    const nextProfile = (data ?? null) as UserProfile | null;
    setProfile(nextProfile);
    writeCachedProfile(nextProfile, userId);
    return nextProfile;
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    const cachedProfile = readCachedProfile(userId);
    setProfile(cachedProfile);

    let cancelled = false;
    setProfileLoading(true);

    supabase
      .from('profiles')
      .select(PROFILE_SELECT)
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;

        setProfileLoading(false);
        if (error) return;

        const nextProfile = (data ?? null) as UserProfile | null;
        setProfile(nextProfile);
        writeCachedProfile(nextProfile, userId);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const updateCachedProfile = useCallback((updates: Partial<UserProfile>) => {
    if (!userId) return;

    setProfile(currentProfile => {
      const baseProfile = currentProfile ?? readCachedProfile(userId);
      if (!baseProfile) return currentProfile;

      const nextProfile = {
        ...baseProfile,
        ...updates,
        user_id: userId,
      };
      writeCachedProfile(nextProfile, userId);
      return nextProfile;
    });
  }, [userId]);

  const logout = async () => {
    applySession(null);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, profile, profileLoading, getValidSession, syncAuthSession, refreshProfile, updateCachedProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
