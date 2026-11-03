import type { Page, Route } from "@playwright/test";

/**
 * Supabase ficticio para las pruebas: responde Auth, REST (tablas y RPC) y Storage desde datos
 * en memoria, y registra las escrituras para verificarlas. Solo entiende los filtros que usa la web
 * (eq, in, gte, lte, is); el resto se ignora.
 */
export type Row = Record<string, unknown>;

export interface MockDb {
  tables: Record<string, Row[]>;
  rpc: Record<string, (args: Record<string, unknown>) => unknown>;
  /** Edge Functions: devuelven [estado HTTP, cuerpo]. */
  functions?: Record<string, (body: Record<string, unknown>) => [number, unknown]>;
}

export interface Write {
  method: string;
  table: string;
  body: unknown;
  query: string;
}

export const USER = { id: "00000000-0000-4000-8000-0000000000aa", email: "e2e@avanceobra.test", aud: "authenticated", role: "authenticated" };

const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: { "access-control-allow-origin": "*", ...headers } });

function filterRows(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, raw] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
    const [op, ...rest] = raw.split(".");
    const val = rest.join(".");
    const get = (r: Row) => {
      const v = r[key];
      return v == null ? v : String(v);
    };
    if (op === "eq") out = out.filter((r) => get(r) === val);
    else if (op === "neq") out = out.filter((r) => get(r) !== val);
    else if (op === "in") {
      const set = new Set(val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")));
      out = out.filter((r) => set.has(String(r[key])));
    } else if (op === "gte") out = out.filter((r) => r[key] != null && String(r[key]) >= val);
    else if (op === "lte") out = out.filter((r) => r[key] != null && String(r[key]) <= val);
    else if (op === "is" && val === "null") out = out.filter((r) => r[key] == null);
    else if (op === "not" && val === "is.null") out = out.filter((r) => r[key] != null);
  }
  // Páginas de .range(): offset y limit
  const offset = Number(params.get("offset") ?? 0);
  const limit = params.get("limit");
  return limit ? out.slice(offset, offset + Number(limit)) : out.slice(offset);
}

/** Instala el simulador en la página; devuelve la lista de escrituras que va registrando. */
export async function mockSupabase(page: Page, db: MockDb, opts: { loggedIn?: boolean; userMetadata?: Record<string, unknown> } = {}): Promise<Write[]> {
  const writes: Write[] = [];
  const user = { ...USER, user_metadata: { ...(opts.userMetadata ?? {}) } };
  const session = {
    access_token: "token-de-prueba",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "refresco-de-prueba",
    user,
  };
  if (opts.loggedIn !== false) {
    // Sesión ya iniciada: supabase-js la lee de localStorage ("sb-<host>-auth-token")
    await page.addInitScript((s) => localStorage.setItem("sb-supabase-auth-token", JSON.stringify(s)), session);
  }

  // Nada sale a internet: mapas base y cualquier otro host se bloquean
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|supabase\.mock)/, (r) => r.abort());

  await page.route("http://supabase.mock/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });

    if (path.startsWith("/auth/v1/token")) return json(route, 200, session);
    if (path.startsWith("/auth/v1/user")) {
      if (req.method() === "PUT") {
        const body = req.postDataJSON() as { data?: Record<string, unknown> };
        writes.push({ method: "PUT", table: "auth.user", body, query: "" });
        Object.assign(user.user_metadata, body.data ?? {});
      }
      return json(route, 200, user);
    }
    const fn = /^\/functions\/v1\/(.+)$/.exec(path);
    if (fn) {
      const handler = db.functions?.[fn[1]!];
      if (!handler) return json(route, 404, { error: `Función ${fn[1]} no simulada` });
      const body = req.postDataJSON() ?? {};
      writes.push({ method: "POST", table: `fn:${fn[1]}`, body, query: "" });
      const [status, out] = handler(body);
      return json(route, status, out);
    }
    if (path.startsWith("/auth/v1/logout")) return route.fulfill({ status: 204 });
    if (path.startsWith("/storage/v1/object/") && req.method() === "POST" && !path.includes("sign")) {
      // Subida de archivo: se registra la ruta (el contenido es binario)
      writes.push({ method: "POST", table: "storage", body: { path: path.replace("/storage/v1/object/", ""), bytes: req.postDataBuffer()?.length ?? 0 }, query: "" });
      return json(route, 200, { Key: path.replace("/storage/v1/object/", ""), Id: "archivo-prueba" });
    }
    if (path.startsWith("/storage/v1/")) return json(route, 200, path.includes("sign") ? [] : {});

    const rpc = /^\/rest\/v1\/rpc\/(.+)$/.exec(path);
    if (rpc) {
      const fn = db.rpc[rpc[1]!];
      if (!fn) return json(route, 404, { message: `RPC ${rpc[1]} no simulada` });
      try {
        return json(route, 200, fn(req.postDataJSON() ?? {}));
      } catch (e) {
        return json(route, 400, { message: (e as Error).message, code: "P0002" });
      }
    }

    const tbl = /^\/rest\/v1\/(.+)$/.exec(path);
    if (!tbl) return json(route, 404, {});
    const table = tbl[1]!;
    const single = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (req.method() === "GET" || req.method() === "HEAD") {
      const rows = filterRows(db.tables[table] ?? [], url.searchParams);
      if (single) return rows[0] ? json(route, 200, rows[0]) : json(route, 406, { code: "PGRST116", message: "0 filas" });
      return json(route, 200, rows);
    }
    // Escrituras: se registran y se aplican en memoria (lo suficiente para recargar la pantalla)
    const body = req.postDataJSON();
    writes.push({ method: req.method(), table, body, query: url.search });
    const list = (db.tables[table] ??= []);
    if (req.method() === "POST") {
      const items = (Array.isArray(body) ? body : [body]).map((b: Row, i: number) => ({ id: `nuevo-${writes.length}-${i}`, token: "token-enlace-prueba", ...b }));
      list.push(...items);
      return json(route, 201, single ? items[0] : items);
    }
    if (req.method() === "PATCH") {
      const target = filterRows(list, url.searchParams);
      target.forEach((r) => Object.assign(r, body));
      return json(route, 200, single ? target[0] ?? {} : target);
    }
    return json(route, 204, null);
  });
  return writes;
}
