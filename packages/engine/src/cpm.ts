/**
 * Método de la ruta crítica (CPM) con relaciones fin-inicio.
 * Sirve para acelerar solo donde realmente se reduce el plazo.
 */

export interface CpmActivity {
  id: string;
  duration: number;
  predecessors: string[];
}

export interface CpmNode {
  id: string;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  totalFloat: number;
  critical: boolean;
}

export interface CpmResult {
  projectDuration: number;
  nodes: Record<string, CpmNode>;
  criticalPath: string[];
}

function topoSort(acts: CpmActivity[]): CpmActivity[] {
  const byId = new Map(acts.map((a) => [a.id, a]));
  const state = new Map<string, 0 | 1 | 2>();
  const out: CpmActivity[] = [];
  const visit = (a: CpmActivity) => {
    const s = state.get(a.id);
    if (s === 2) return;
    if (s === 1) throw new Error(`Ciclo en las dependencias del cronograma (actividad ${a.id})`);
    state.set(a.id, 1);
    for (const p of a.predecessors) {
      const pa = byId.get(p);
      if (!pa) throw new Error(`La actividad ${a.id} depende de ${p}, que no existe`);
      visit(pa);
    }
    state.set(a.id, 2);
    out.push(a);
  };
  acts.forEach(visit);
  return out;
}

export function criticalPath(activities: CpmActivity[]): CpmResult {
  const order = topoSort(activities);
  const nodes: Record<string, CpmNode> = {};
  for (const a of order) {
    const es = Math.max(0, ...a.predecessors.map((p) => nodes[p]!.ef));
    nodes[a.id] = { id: a.id, es, ef: es + a.duration, ls: 0, lf: 0, totalFloat: 0, critical: false };
  }
  const projectDuration = Math.max(0, ...Object.values(nodes).map((n) => n.ef));
  const successors = new Map<string, string[]>();
  for (const a of activities) for (const p of a.predecessors) successors.set(p, [...(successors.get(p) ?? []), a.id]);
  for (const a of [...order].reverse()) {
    const succ = successors.get(a.id) ?? [];
    const lf = succ.length ? Math.min(...succ.map((s) => nodes[s]!.ls)) : projectDuration;
    const n = nodes[a.id]!;
    n.lf = lf;
    n.ls = lf - a.duration;
    n.totalFloat = n.ls - n.es;
    n.critical = Math.abs(n.totalFloat) < 1e-9;
  }
  const criticalPath = order.filter((a) => nodes[a.id]!.critical).map((a) => a.id);
  return { projectDuration, nodes, criticalPath };
}
