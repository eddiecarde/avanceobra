"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

export interface Membership {
  project_id: string;
  org_id: string;
  role: "field" | "resident" | "director" | "admin";
  /** La empresa de esta obra está suspendida por el dueño de la plataforma. */
  org_suspended?: boolean;
  /** Si es de un subcontratista: ve solo las actividades de su empresa. */
  sub_company_id?: string | null;
  project: { id: string; code: string; name: string; org_id: string } | null;
}

interface SessionState {
  loading: boolean;
  session: Session | null;
  memberships: Membership[];
  /** Empresa activa (la primera donde el usuario es administrador). */
  orgId: string | null;
  isAdmin: boolean;
  projectIds: string[];
  /** Proyecto elegido en el menú lateral (vacío = el primero); todas las páginas lo comparten. */
  currentProjectId: string;
  setCurrentProjectId: (id: string) => void;
  signOut: () => Promise<void>;
  /** Vuelve a leer las obras del usuario (p. ej. después de crear una). */
  reloadMemberships: () => void;
  /** Dueño de la plataforma: ve el panel de empresas. */
  isPlatformAdmin: boolean;
  /** Todas las obras del usuario son de empresas suspendidas. */
  suspended: boolean;
}

const PROJECT_KEY = "avanceobra:proyecto-actual";

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  // De qué usuario son las membresías cargadas: mientras no sean las de la sesión actual, sigue cargando
  const [membershipsOf, setMembershipsOf] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [suspendedOnly, setSuspendedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentProjectId, setCurrent] = useState(() => {
    try {
      return typeof window === "undefined" ? "" : (localStorage.getItem(PROJECT_KEY) ?? "");
    } catch {
      return "";
    }
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setMemberships([]);
      return;
    }
    setLoading(true);
    void Promise.all([
      supabase.from("memberships").select("project_id, org_id, role, org_suspended, sub_company_id, project:projects(id, code, name, org_id)").eq("user_id", session.user.id),
      supabase.from("platform_admins").select("user_id").eq("user_id", session.user.id).maybeSingle(),
    ]).then(([{ data }, owner]) => {
      const all = (data ?? []) as unknown as Membership[];
      // Las obras de empresas suspendidas no se muestran (la base de datos tampoco deja leerlas)
      setMemberships(all.filter((m) => !m.org_suspended));
      setSuspendedOnly(all.length > 0 && all.every((m) => m.org_suspended));
      setIsPlatformAdmin(!!owner.data);
      setMembershipsOf(session.user.id);
      setLoading(false);
    });
  }, [session, reloadKey]);

  const value = useMemo<SessionState>(() => {
    const admin = memberships.find((m) => m.role === "admin");
    const orgId = admin?.org_id ?? memberships[0]?.org_id ?? null;
    return {
      loading: loading || (!!session && membershipsOf !== session.user.id),
      session,
      memberships,
      orgId,
      isAdmin: Boolean(admin),
      projectIds: memberships.filter((m) => m.org_id === orgId).map((m) => m.project_id),
      // Solo vale si el usuario sigue en ese proyecto
      currentProjectId: memberships.some((m) => m.project_id === currentProjectId) ? currentProjectId : "",
      setCurrentProjectId: (id: string) => {
        setCurrent(id);
        try {
          localStorage.setItem(PROJECT_KEY, id);
        } catch {
          // sin almacenamiento: se recuerda solo en esta pestaña
        }
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
      reloadMemberships: () => setReloadKey((k) => k + 1),
      isPlatformAdmin,
      suspended: suspendedOnly,
    };
  }, [loading, session, memberships, membershipsOf, currentProjectId, isPlatformAdmin, suspendedOnly]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession fuera de SessionProvider");
  return v;
}

/** [proyecto elegido, elegir otro]: reemplaza el selector propio de cada página por el compartido. */
export function useCurrentProject(): [string, (id: string) => void] {
  const { currentProjectId, setCurrentProjectId } = useSession();
  return [currentProjectId, setCurrentProjectId];
}
