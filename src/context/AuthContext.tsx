import { createContext, useCallback, useContext, useState, useEffect, type ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const userId = user?.id ?? null;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

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
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, profile, profileLoading, refreshProfile, updateCachedProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
