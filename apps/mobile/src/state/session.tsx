import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@powersync/react";
import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Role } from "@avanceobra/shared";
import { startSync, stopSync } from "../db/database";
import { startFileQueue, stopFileQueue } from "../services/fileQueue";
import { registerPushToken, setupNotifications } from "../services/notifications";
import { supabase } from "../services/supabase";
import { checkForAppUpdate } from "../services/updates";

interface SessionState {
  ready: boolean;
  session: Session | null;
  userId: string | null;
  userName: string;
  projectId: string | null;
  setProjectId: (id: string) => void;
  role: Role | null;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);
const PROJECT_KEY = "avanceobra.projectId";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [projectId, setProjectIdState] = useState<string | null>(null);

  useEffect(() => {
    // getSession lee la sesión guardada: no necesita red, así la app abre offline.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    void checkForAppUpdate();
    AsyncStorage.getItem(PROJECT_KEY).then((v) => v && setProjectIdState(v)).catch(() => undefined);
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    void startSync();
    startFileQueue();
    void setupNotifications().then(() => registerPushToken(session.user.id));
    return () => stopFileQueue();
  }, [session]);

  const userId = session?.user.id ?? null;
  const { data: memberships } = useQuery<{ project_id: string; role: Role; member_name: string | null }>(
    "SELECT project_id, role, member_name FROM memberships WHERE user_id = ?",
    [userId ?? ""],
  );

  // Si hay un solo proyecto se selecciona solo (un toque menos en campo).
  useEffect(() => {
    if (!projectId && memberships.length === 1) setProjectId(memberships[0]!.project_id);
  }, [memberships, projectId]);

  function setProjectId(id: string) {
    setProjectIdState(id);
    AsyncStorage.setItem(PROJECT_KEY, id).catch(() => undefined);
  }

  const value = useMemo<SessionState>(() => {
    const m = memberships.find((x) => x.project_id === projectId);
    return {
      ready,
      session,
      userId,
      userName: m?.member_name ?? session?.user.email ?? "",
      projectId,
      setProjectId,
      role: m?.role ?? null,
      signOut: async () => {
        stopFileQueue();
        await stopSync(true);
        await AsyncStorage.removeItem(PROJECT_KEY);
        await supabase.auth.signOut();
      },
    };
  }, [ready, session, userId, projectId, memberships]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession fuera de SessionProvider");
  return v;
}
