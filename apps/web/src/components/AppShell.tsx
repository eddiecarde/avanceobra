"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { fetchWeather, type Weather } from "@/lib/weather";
import { Icon, type IconName } from "./icons";
import { Button, cx } from "./ui";

interface Page {
  href: string;
  label: string;
  icon: IconName;
}

// Menú en 4 grupos. En el computador va en la barra lateral; en el celular, arriba el grupo y debajo sus páginas
const GROUPS: { label: string; pages: Page[] }[] = [
  {
    label: "Seguimiento",
    pages: [
      { href: "/dashboard", label: "Dashboard", icon: "home" },
      { href: "/gerencia", label: "Gerencia", icon: "gauge" },
      { href: "/centro", label: "Centro de control", icon: "gauge" },
      { href: "/plan", label: "Plan semanal", icon: "target" },
      { href: "/informe", label: "Informe diario", icon: "doc" },
      { href: "/semanal", label: "Informe semanal", icon: "calendar" },
    ],
  },
  {
    label: "Decisiones",
    pages: [
      { href: "/actas", label: "Actas de cobro", icon: "receipt" },
      { href: "/subcontratistas", label: "Subcontratistas", icon: "users" },
      { href: "/valor-ganado", label: "Valor ganado (EVM)", icon: "trend" },
      { href: "/costos", label: "Costos y productividad", icon: "coins" },
      { href: "/simulador", label: "Acelerar vs. multa", icon: "scale" },
      { href: "/biblioteca", label: "Rendimientos y costos", icon: "book" },
    ],
  },
  {
    label: "Campo",
    pages: [
      { href: "/registros", label: "Registros", icon: "list" },
      { href: "/calidad", label: "Calidad", icon: "check" },
      { href: "/control", label: "Ensayos y restricciones", icon: "flask" },
      { href: "/materiales", label: "Materiales", icon: "box" },
      { href: "/sst", label: "Seguridad social y SST", icon: "hardhat" },
      { href: "/personal", label: "Personal, equipos y lluvia", icon: "hardhat" },
      { href: "/formatos", label: "Formatos", icon: "form" },
    ],
  },
  {
    label: "Ajustes",
    pages: [
      { href: "/proyecto", label: "Proyecto", icon: "gear" },
      { href: "/planos", label: "Planos", icon: "map" },
      { href: "/importar", label: "Programación", icon: "upload" },
      { href: "/equipo", label: "Equipo", icon: "users" },
      { href: "/empresa", label: "Empresa", icon: "users" },
    ],
  },
];

const ROLE_LABEL = { admin: "Administrador", director: "Director de proyecto", resident: "Residente de obra", field: "Supervisor de campo" } as const;
const ROLE_ORDER = ["admin", "director", "resident", "field"] as const;

const tab = (active: boolean) =>
  cx(
    "shrink-0 whitespace-nowrap rounded-lg py-1.5 font-semibold",
    active ? "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900",
  );

function Logo({ dark }: { dark?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5">
      <svg width="34" height="30" viewBox="0 0 34 30" aria-hidden>
        <path d="M17 1 33 29h-8.5L17 15.5 9.5 29H1z" fill="#2f80ed" />
        <path d="M17 15.5 24.5 29h-15z" fill="#93c5fd" />
      </svg>
      <span className="leading-tight">
        <span className={cx("block text-[19px] font-extrabold tracking-tight", dark ? "text-white" : "")}>
          Avance<span className={dark ? "text-blue-300" : "text-blue-700"}>Obra</span>
        </span>
        {dark ? <span className="block text-xs text-blue-200/80">Control de obras, resultados reales</span> : null}
      </span>
    </Link>
  );
}

/** Marco de la web: barra lateral (computador) o menú superior (celular), usuario y control de sesión (redirige a /login). */
export function AppShell({ children }: { children: ReactNode }) {
  const { loading, session, isAdmin, memberships, signOut, isPlatformAdmin, suspended } = useSession();
  // El dueño de la plataforma ve además el panel de empresas
  const groups = GROUPS.map((g) =>
    g.label === "Ajustes"
      ? {
          ...g,
          // Empresa: solo el administrador; Panel del dueño: solo el dueño de la plataforma
          pages: [
            ...g.pages.filter((p) => p.href !== "/empresa" || isAdmin),
            ...(isPlatformAdmin ? [{ href: "/dueno", label: "Panel del dueño", icon: "gauge" as const }] : []),
          ],
        }
      : g,
  );
  const path = usePathname();
  const router = useRouter();
  const isLogin = path === "/login";
  // El enlace compartido se ve sin sesión y sin el menú de administración
  const isPublic = path === "/ver";
  // El cliente (sin membresía en ningún proyecto) solo usa su portal, sin el menú del equipo
  const isClientPortal = path === "/cliente";
  const group = groups.find((g) => g.pages.some((n) => path.startsWith(n.href)));

  useEffect(() => {
    if (isPublic) return;
    if (!loading && !session && !isLogin) router.replace("/login");
    // Quien entró con contraseña temporal la cambia antes de seguir
    if (!loading && session?.user.user_metadata?.must_change_password && path !== "/cuenta") router.replace("/cuenta");
    if (!loading && session && (isLogin || path === "/")) router.replace(memberships.length || suspended ? "/dashboard" : "/cliente");
    else if (!loading && session && !memberships.length && !suspended && !isClientPortal && path !== "/cuenta") router.replace("/cliente");
  }, [loading, session, memberships.length, suspended, isLogin, isPublic, isClientPortal, path, router]);

  if (isLogin || isPublic) return <>{children}</>;
  if (loading || !session) return <div className="p-8 text-zinc-500">Cargando…</div>;
  if (isClientPortal) return <>{children}</>;
  if (suspended && path !== "/cuenta")
    return (
      <div className="mx-auto max-w-lg p-8">
        <Logo />
        <h1 className="mt-6 text-2xl font-extrabold">Tu empresa está suspendida</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Los datos de tus obras se conservan, pero por ahora no se puede entrar. Comunícate con el administrador de AvanceObra para reactivarla.
        </p>
        <button onClick={() => void signOut()} className="mt-6 rounded-lg border border-zinc-300 px-4 py-2 font-semibold dark:border-zinc-700">
          Salir
        </button>
      </div>
    );

  const email = session.user.email ?? "";
  const name = (session.user.user_metadata?.full_name as string | undefined)?.trim() || email.split("@")[0]!;
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const role = ROLE_ORDER.find((r) => memberships.some((m) => m.role === r));

  return (
    <div className="min-h-screen">
      {/* Computador: barra lateral fija */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-gradient-to-b from-[#0b2547] to-[#071a33] text-blue-50 lg:flex print:hidden">
        <div className="px-5 pt-6 pb-5">
          <Logo dark />
        </div>
        <nav aria-label="Menú principal" className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-widest text-blue-200/50">{g.label}</div>
              {g.pages.map((n) => {
                const active = path.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-[14.5px]",
                      active ? "bg-blue-600 font-semibold text-white shadow-md shadow-blue-950/40" : "text-blue-100/85 hover:bg-white/8 hover:text-white",
                    )}
                  >
                    <Icon name={n.icon} size={19} />
                    {n.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <ProjectBox />
        <div className="border-t border-white/10 px-5 py-4 text-sm">
          <div className="flex items-center gap-2 text-emerald-300">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> En línea
          </div>
          <p className="mt-1 text-xs text-blue-200/70">La web lee los datos en vivo; el teléfono sincroniza al tener señal.</p>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 print:hidden">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 lg:px-6">
            <div className="lg:hidden">
              <Logo />
            </div>
            {/* Celular: grupos arriba */}
            <nav aria-label="Secciones" className="order-last -mx-1 flex w-full gap-0.5 overflow-x-auto px-1 sm:gap-1 md:order-none md:w-auto lg:hidden">
              {groups.map((g) => (
                <Link key={g.label} href={g.pages[0]!.href} aria-current={g === group ? "true" : undefined} className={cx(tab(g === group), "px-2 text-sm sm:px-3 sm:text-[15px]")}>
                  {g.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3 text-sm">
              <Link href="/cuenta" className="flex items-center gap-2.5 rounded-lg px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="Mi cuenta: cambiar contraseña">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#0b2547] text-sm font-bold text-white">{initials || "?"}</span>
                <span className="hidden leading-tight sm:block">
                  <span className="block font-semibold text-zinc-900 dark:text-zinc-100">{name}</span>
                  <span className="block text-xs text-zinc-500">{role ? ROLE_LABEL[role] : email}</span>
                </span>
              </Link>
              <Button size="sm" variant="ghost" onClick={() => void signOut()}>
                <Icon name="logout" size={16} /> Salir
              </Button>
            </div>
          </div>
          {group ? (
            <nav aria-label={group.label} className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto border-t border-zinc-100 px-4 py-1.5 lg:hidden dark:border-zinc-900">
              {group.pages.map((n) => (
                <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? "page" : undefined} className={cx(tab(path.startsWith(n.href)), "px-3 py-1 text-sm")}>
                  {n.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </header>
        {!isAdmin ? (
          <div className="mx-auto max-w-[1600px] px-4 pt-4 lg:px-6">
            <div className="rounded-lg bg-amber-50 px-4 py-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Estás en modo lectura: solo el administrador de la empresa puede editar formatos y la biblioteca.
            </div>
          </div>
        ) : null}
        <main className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}

/** Menú lateral: proyecto actual (se comparte con todas las páginas) y clima de la obra hoy. */
function ProjectBox() {
  const { memberships, currentProjectId, setCurrentProjectId, isAdmin } = useSession();
  const projects = useMemo(() => [...new Map(memberships.filter((m) => m.project).map((m) => [m.project_id, m.project!])).values()], [memberships]);
  const projectId = currentProjectId || projects[0]?.id || "";
  const [place, setPlace] = useState<{ projectId: string; name: string | null; weather: Weather | null } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let off = false;
    void supabase
      .from("projects")
      .select("location_name, lat, lon")
      .eq("id", projectId)
      .maybeSingle()
      .then(async ({ data }) => {
        const p = data as { location_name: string | null; lat: number | null; lon: number | null } | null;
        const weather = p?.lat != null && p.lon != null ? await fetchWeather(p.lat, p.lon) : null;
        if (!off) setPlace({ projectId, name: p?.location_name ?? null, weather });
      });
    return () => {
      off = true;
    };
  }, [projectId]);

  if (!projects.length) return null;
  const here = place?.projectId === projectId ? place : null;
  return (
    <div className="space-y-3 border-t border-white/10 px-5 py-4 text-sm">
      <label className="block">
        <span className="mb-1 block text-xs text-blue-200/70">Proyecto actual</span>
        {projects.length > 1 ? (
          <select
            value={projectId}
            onChange={(e) => setCurrentProjectId(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 font-semibold text-white outline-none focus:border-blue-400"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id} className="text-zinc-900">
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="block font-semibold text-white">{projects[0]!.name}</span>
        )}
      </label>
      {memberships.some((m) => m.project_id === projectId && m.sub_company_id) ? (
        <p className="text-xs text-amber-200">Vista de subcontratista: ves solo las actividades de tu empresa.</p>
      ) : null}
      {isAdmin ? (
        <Link href="/nuevo-proyecto" className="block text-xs font-semibold text-blue-200 hover:text-white hover:underline">
          + Nuevo proyecto
        </Link>
      ) : null}
      {here?.weather ? (
        <div className="flex items-center gap-3" title="Clima actual en la obra (Open-Meteo)">
          <Icon name={here.weather.code >= 51 ? "rain" : "cloud"} size={30} className="text-blue-200" />
          <div className="leading-tight">
            <div className="text-xs text-blue-200/70">{here.name ?? "En la obra"}</div>
            <div className="text-lg font-bold text-white tabular-nums">{Math.round(here.weather.temperature)} °C</div>
            <div className="text-xs text-blue-100/80">{here.weather.label}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
