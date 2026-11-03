/**
 * Fórmulas calculadas, evaluadas con un intérprete propio (sin eval ni Function):
 * números, campos por id, + − × ÷ ^, paréntesis, comparaciones y funciones
 *   min, max, abs, round(x, n), sqrt, if(cond, a, b)
 *   sum(tabla.col), avg(tabla.col), count(tabla), minof(tabla.col), maxof(tabla.col)
 * Ejemplos: "largo * ancho * espesor"  ·  "round(avg(cilindros.resistencia) / 21 * 100, 1)"
 */

type Token =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" }
  | { t: "," };

export class FormulaError extends Error {}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new FormulaError(`Número inválido: ${src.slice(i, j)}`);
      out.push({ t: "num", v: n });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_.]/.test(src[j]!)) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if ([">=", "<=", "==", "!="].includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^<>".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(") out.push({ t: "(" });
    else if (c === ")") out.push({ t: ")" });
    else if (c === ",") out.push({ t: "," });
    else throw new FormulaError(`Carácter no permitido: "${c}"`);
    i++;
  }
  return out;
}

export type Node =
  | { k: "num"; v: number }
  | { k: "ref"; name: string }
  | { k: "un"; op: "-"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

const FUNCS = new Set(["min", "max", "abs", "round", "sqrt", "if", "sum", "avg", "count", "minof", "maxof"]);
const TABLE_FUNCS = new Set(["sum", "avg", "count", "minof", "maxof"]);

/** Gramática: cmp := add ((>|<|>=|<=|==|!=) add)? ; add := mul ((+|-) mul)* ; mul := pow ((*|/) pow)* ; pow := unary (^ pow)? */
export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (...ops: string[]) => {
    const t = peek();
    return t?.t === "op" && ops.includes(t.v);
  };

  function primary(): Node {
    const t = toks[p++];
    if (!t) throw new FormulaError("La fórmula termina antes de tiempo");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "(") {
      const e = cmp();
      if (toks[p++]?.t !== ")") throw new FormulaError("Falta cerrar un paréntesis");
      return e;
    }
    if (t.t === "id") {
      if (peek()?.t === "(") {
        const fn = t.v.toLowerCase();
        if (!FUNCS.has(fn)) throw new FormulaError(`Función desconocida: ${t.v}`);
        p++;
        const args: Node[] = [];
        if (peek()?.t !== ")") {
          args.push(cmp());
          while (peek()?.t === ",") {
            p++;
            args.push(cmp());
          }
        }
        if (toks[p++]?.t !== ")") throw new FormulaError(`Falta cerrar el paréntesis de ${fn}(`);
        return { k: "call", fn, args };
      }
      return { k: "ref", name: t.v };
    }
    throw new FormulaError("Expresión incompleta");
  }
  function unary(): Node {
    if (isOp("-")) {
      p++;
      return { k: "un", op: "-", a: unary() };
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return primary();
  }
  function pow(): Node {
    const a = unary();
    if (isOp("^")) {
      p++;
      return { k: "bin", op: "^", a, b: pow() };
    }
    return a;
  }
  function mul(): Node {
    let a = pow();
    while (isOp("*", "/")) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: pow() };
    }
    return a;
  }
  function add(): Node {
    let a = mul();
    while (isOp("+", "-")) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: mul() };
    }
    return a;
  }
  function cmp(): Node {
    const a = add();
    if (isOp(">", "<", ">=", "<=", "==", "!=")) {
      const op = (toks[p++] as { v: string }).v;
      return { k: "bin", op, a, b: add() };
    }
    return a;
  }

  if (toks.length === 0) throw new FormulaError("La fórmula está vacía");
  const ast = cmp();
  if (p < toks.length) throw new FormulaError("Sobra texto al final de la fórmula");
  return ast;
}

/** Campos que usa la fórmula (para validar referencias y detectar ciclos). Para tabla.col devuelve "tabla". */
export function formulaRefs(src: string): string[] {
  const refs = new Set<string>();
  const walk = (n: Node) => {
    if (n.k === "ref") refs.add(n.name.split(".")[0]!);
    else if (n.k === "un") walk(n.a);
    else if (n.k === "bin") {
      walk(n.a);
      walk(n.b);
    } else if (n.k === "call") n.args.forEach(walk);
  };
  walk(parseFormula(src));
  return [...refs];
}

const toNum = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
};

function tableColumn(values: Record<string, unknown>, ref: string): number[] {
  const [table, col] = ref.split(".");
  const rows = values[table!];
  if (!Array.isArray(rows)) return [];
  if (!col) return rows.map(() => 1);
  return rows.map((r) => toNum((r as Record<string, unknown>)[col])).filter((n) => Number.isFinite(n));
}

/** Evalúa la fórmula. Devuelve NaN si falta algún dato (el campo queda vacío, no da error). */
export function evaluateFormula(src: string | Node, values: Record<string, unknown>): number {
  const ast = typeof src === "string" ? parseFormula(src) : src;
  const ev = (n: Node): number => {
    switch (n.k) {
      case "num":
        return n.v;
      case "ref":
        return toNum(values[n.name]);
      case "un":
        return -ev(n.a);
      case "bin": {
        const a = ev(n.a);
        const b = ev(n.b);
        switch (n.op) {
          case "+": return a + b;
          case "-": return a - b;
          case "*": return a * b;
          case "/": return b === 0 ? NaN : a / b;
          case "^": return a ** b;
          case ">": return a > b ? 1 : 0;
          case "<": return a < b ? 1 : 0;
          case ">=": return a >= b ? 1 : 0;
          case "<=": return a <= b ? 1 : 0;
          case "==": return a === b ? 1 : 0;
          case "!=": return a !== b ? 1 : 0;
        }
        return NaN;
      }
      case "call": {
        if (TABLE_FUNCS.has(n.fn)) {
          const arg = n.args[0];
          if (!arg || arg.k !== "ref") throw new FormulaError(`${n.fn}() necesita una columna de tabla, p. ej. ${n.fn}(tabla.columna)`);
          const xs = tableColumn(values, arg.name);
          if (n.fn === "count") return xs.length;
          if (xs.length === 0) return NaN;
          if (n.fn === "sum") return xs.reduce((s, x) => s + x, 0);
          if (n.fn === "avg") return xs.reduce((s, x) => s + x, 0) / xs.length;
          if (n.fn === "minof") return Math.min(...xs);
          return Math.max(...xs);
        }
        const args = n.args.map(ev);
        switch (n.fn) {
          case "min": return Math.min(...args);
          case "max": return Math.max(...args);
          case "abs": return Math.abs(args[0]!);
          case "sqrt": return Math.sqrt(args[0]!);
          case "round": {
            const f = 10 ** (args[1] ?? 0);
            return Math.round(args[0]! * f) / f;
          }
          case "if": return args[0] ? args[1]! : args[2]!;
        }
        return NaN;
      }
    }
  };
  return ev(ast);
}
