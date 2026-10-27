// GENERADO por scripts/build-functions.mjs desde packages/engine. No editar a mano.
// deno-lint-ignore-file

// packages/engine/src/calendar.ts
var DAY_MS = 864e5;
function parseDate(d) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function formatDate(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  return formatDate(new Date(parseDate(d).getTime() + n * DAY_MS));
}
function diffDays(a, b) {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY_MS);
}
function isoWeekday(d) {
  const w = d.getUTCDay();
  return w === 0 ? 7 : w;
}
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return formatDate(new Date(Date.UTC(year, month - 1, day)));
}
function nextMonday(d) {
  const wd = isoWeekday(parseDate(d));
  return wd === 1 ? d : addDays(d, 8 - wd);
}
var pad = (n) => String(n).padStart(2, "0");
function colombianHolidays(year) {
  const ymd = (m, d) => `${year}-${pad(m)}-${pad(d)}`;
  const fixed = [ymd(1, 1), ymd(5, 1), ymd(7, 20), ymd(8, 7), ymd(12, 8), ymd(12, 25)];
  const emiliani = [ymd(1, 6), ymd(3, 19), ymd(6, 29), ymd(8, 15), ymd(10, 12), ymd(11, 1), ymd(11, 11)].map(
    nextMonday
  );
  const easter = easterSunday(year);
  const easterBased = [
    addDays(easter, -3),
    // Jueves Santo
    addDays(easter, -2),
    // Viernes Santo
    nextMonday(addDays(easter, 39)),
    // Ascensión
    nextMonday(addDays(easter, 60)),
    // Corpus Christi
    nextMonday(addDays(easter, 68))
    // Sagrado Corazón
  ];
  return [...fixed, ...emiliani, ...easterBased].sort();
}
function buildHolidaySet(cal, fromYear, toYear) {
  const set = new Set(cal.holidays ?? []);
  if (cal.colombianHolidays !== false) {
    for (let y = fromYear; y <= toYear; y++) colombianHolidays(y).forEach((h) => set.add(h));
  }
  return set;
}
function isWorkingDay(d, cal = {}, holidays) {
  const workdays = cal.workdays ?? [1, 2, 3, 4, 5, 6];
  const date = parseDate(d);
  if (!workdays.includes(isoWeekday(date))) return false;
  const set = holidays ?? buildHolidaySet(cal, date.getUTCFullYear(), date.getUTCFullYear());
  return !set.has(d);
}
function workingDaysBetween(from, to, cal = {}) {
  if (diffDays(from, to) < 0) return 0;
  const set = buildHolidaySet(cal, parseDate(from).getUTCFullYear(), parseDate(to).getUTCFullYear());
  let n = 0;
  for (let d = from; diffDays(d, to) >= 0; d = addDays(d, 1)) if (isWorkingDay(d, cal, set)) n++;
  return n;
}
function workdayCounter(cal, from, to) {
  const n = Math.max(0, diffDays(from, to) + 1);
  const set = buildHolidaySet(cal, parseDate(from).getUTCFullYear(), parseDate(to).getUTCFullYear());
  const cum = new Int32Array(n + 1);
  let d = from;
  for (let i = 0; i < n; i++, d = addDays(d, 1)) cum[i + 1] = cum[i] + (isWorkingDay(d, cal, set) ? 1 : 0);
  return (a, b) => {
    if (b < a) return 0;
    const ia = diffDays(from, a);
    const ib = diffDays(from, b);
    if (ia < 0 || ib >= n) return workingDaysBetween(a, b, cal);
    return cum[ib + 1] - cum[ia];
  };
}
function addWorkingDays(start, n, cal = {}) {
  if (n <= 0) return start;
  const startYear = parseDate(start).getUTCFullYear();
  const set = buildHolidaySet(cal, startYear, startYear + Math.ceil(n / 200) + 1);
  let count = 0;
  let d = start;
  for (; ; ) {
    if (isWorkingDay(d, cal, set)) count++;
    if (count >= n) return d;
    d = addDays(d, 1);
  }
}
function availableDays(from, to, cal = {}, rainLossRatio = 0) {
  const working = workingDaysBetween(from, to, cal);
  const rainDays = Math.round(working * rainLossRatio);
  return { workingDays: working, rainDays, available: Math.max(0, working - rainDays) };
}

// packages/engine/src/productivity.ts
function referenceDailyRate(r) {
  const factor = Object.values(r.factors ?? {}).reduce((acc, f) => acc * f, 1);
  return r.refRatePerHour * r.effectiveHoursPerDay * (r.availability ?? 1) * (r.shifts ?? 1) * factor;
}
var MIN_SAMPLES_FOR_RELIABLE = 7;
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function historicalRate(records, lastNDays) {
  const valid = records.filter((r) => r.units > 0).sort((a, b) => a.date.localeCompare(b.date));
  const window = lastNDays ? valid.slice(-lastNDays) : valid;
  const perUnit = window.map((r) => r.quantity / r.units);
  const n = perUnit.length;
  const mean = n ? perUnit.reduce((a, b) => a + b, 0) / n : 0;
  const variance = n > 1 ? perUnit.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const sorted = [...perUnit].sort((a, b) => a - b);
  const warnings = [];
  if (n < MIN_SAMPLES_FOR_RELIABLE)
    warnings.push(
      `Solo hay ${n} d\xEDas con datos (m\xEDnimo recomendado ${MIN_SAMPLES_FOR_RELIABLE}): la proyecci\xF3n es poco confiable.`
    );
  if (cv > 0.5) warnings.push("El rendimiento diario es muy variable (CV > 50 %): revise causas de p\xE9rdida.");
  return {
    source: "historical",
    meanPerUnit: mean,
    p20PerUnit: percentile(sorted, 0.2),
    p80PerUnit: percentile(sorted, 0.8),
    samples: n,
    coefficientOfVariation: cv,
    reliable: n >= MIN_SAMPLES_FOR_RELIABLE && cv <= 0.5,
    warnings
  };
}
function compareRates(referencePerUnit, realPerUnit, resourceName = "el recurso") {
  const ratio3 = referencePerUnit > 0 ? realPerUnit / referencePerUnit : 0;
  const warnings = [];
  if (ratio3 < 0.6)
    warnings.push(
      `El rendimiento real de ${resourceName} es ${(ratio3 * 100).toFixed(0)} % del de referencia. Probablemente el recurso limitante es otro (acarreo/volquetas, compactaci\xF3n, frente de trabajo o permisos): revise la cadena antes de agregar m\xE1s unidades de ${resourceName}.`
    );
  else if (ratio3 > 1.3)
    warnings.push(`El rendimiento real supera en ${((ratio3 - 1) * 100).toFixed(0)} % la referencia: verifique las cantidades reportadas.`);
  return { referencePerUnit, realPerUnit, ratio: ratio3, warnings };
}

// packages/engine/src/equipment.ts
function unitEfficiency(i, s = {}) {
  const full = s.fullEfficiencyUnits ?? Infinity;
  if (i <= full) return 1;
  return (s.decay ?? 1) ** (i - full);
}
function crewOutput(n, perUnitDaily, s = {}) {
  let total = 0;
  for (let i = 1; i <= n; i++) total += perUnitDaily * unitEfficiency(i, s);
  return total;
}
function requiredEquipment(input) {
  const { pendingQty, availableDays: availableDays2, perUnitDaily, currentUnits, saturation = {} } = input;
  const name = input.resourceName ?? "unidades";
  const warnings = [];
  if (availableDays2 <= 0) {
    return {
      requiredDailyRate: Infinity,
      theoreticalUnits: Infinity,
      requiredUnits: null,
      gap: null,
      currentDailyOutput: crewOutput(currentUnits, perUnitDaily, saturation),
      message: "No quedan d\xEDas disponibles antes de la fecha l\xEDmite.",
      warnings: ["La fecha l\xEDmite ya pas\xF3 o no hay d\xEDas laborables: el retraso es inevitable."]
    };
  }
  const requiredDailyRate = pendingQty / availableDays2;
  const theoreticalUnits = requiredDailyRate / perUnitDaily;
  const cap = saturation.maxUnits ?? 1e3;
  let requiredUnits = null;
  for (let n = 0; n <= cap; n++) {
    if (crewOutput(n, perUnitDaily, saturation) >= requiredDailyRate - 1e-9) {
      requiredUnits = n;
      break;
    }
  }
  if (requiredUnits === null)
    warnings.push(
      `Ni con el m\xE1ximo de ${cap} ${name} que caben en el frente se alcanza el rendimiento requerido: abrir otro frente, agregar turnos o renegociar plazo.`
    );
  if (saturation.fullEfficiencyUnits !== void 0 && requiredUnits !== null && requiredUnits > saturation.fullEfficiencyUnits)
    warnings.push(
      `Por encima de ${saturation.fullEfficiencyUnits} ${name} el frente se satura y cada unidad adicional rinde menos.`
    );
  const gap = requiredUnits === null ? null : requiredUnits - currentUnits;
  const message = requiredUnits === null ? `Necesitas ${requiredDailyRate.toFixed(1)} ${input.unit ?? ""}/d\xEDa y no es alcanzable en este frente.` : gap > 0 ? `Tienes ${currentUnits} ${name}, necesitas ${requiredUnits} (faltan ${gap}).` : `Tienes ${currentUnits} ${name}, bastan ${requiredUnits}${gap < 0 ? ` (sobran ${-gap})` : ""}.`;
  return {
    requiredDailyRate,
    theoreticalUnits,
    requiredUnits,
    gap,
    currentDailyOutput: crewOutput(currentUnits, perUnitDaily, saturation),
    message,
    warnings
  };
}
function bottleneck(stages) {
  const caps = stages.map((s) => ({ name: s.name, capacity: crewOutput(s.units, s.perUnitDaily, s.saturation) }));
  const limiting = caps.reduce((min, c) => c.capacity < min.capacity ? c : min);
  return {
    throughput: limiting.capacity,
    limiting: limiting.name,
    stages: caps.map((c) => ({ ...c, utilization: c.capacity > 0 ? limiting.capacity / c.capacity : 0 })),
    message: `El recurso limitante es "${limiting.name}" (${limiting.capacity.toFixed(0)}/d\xEDa). Agregar unidades en otros eslabones no acelera.`
  };
}

// packages/engine/src/projection.ts
function project(input, rate) {
  if (rate <= 0) return { dailyRate: rate, workingDaysNeeded: Infinity, finishDate: null, delayDays: null };
  const effectiveRate = rate * (1 - (input.rainLossRatio ?? 0));
  const days2 = Math.ceil(input.pendingQty / effectiveRate - 1e-9);
  const finish = addWorkingDays(input.fromDate, days2, input.calendar);
  return { dailyRate: rate, workingDaysNeeded: days2, finishDate: finish, delayDays: diffDays(input.deadline, finish) };
}
function projectCompletion(input) {
  const optimistic = project(input, input.rates.optimistic);
  const expected = project(input, input.rates.expected);
  const pessimistic = project(input, input.rates.pessimistic);
  let message;
  if (expected.finishDate === null) message = `La actividad ${input.activityName} no avanza: sin rendimiento no hay fecha de terminaci\xF3n.`;
  else if (expected.delayDays > 0)
    message = `Al ritmo actual, la actividad ${input.activityName} termina el ${expected.finishDate}, con ${expected.delayDays} d\xEDas de retraso.`;
  else
    message = `Al ritmo actual, la actividad ${input.activityName} termina el ${expected.finishDate}, ${-expected.delayDays} d\xEDas antes de la fecha l\xEDmite.`;
  return { optimistic, expected, pessimistic, message };
}
function durationDays(pendingQty, dailyRate) {
  return dailyRate > 0 ? Math.ceil(pendingQty / dailyRate - 1e-9) : Infinity;
}

// packages/engine/src/cpm.ts
function topoSort(acts) {
  const byId = new Map(acts.map((a) => [a.id, a]));
  const state = /* @__PURE__ */ new Map();
  const out = [];
  const visit = (a) => {
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
function criticalPath(activities) {
  const order = topoSort(activities);
  const nodes = {};
  for (const a of order) {
    const es = Math.max(0, ...a.predecessors.map((p) => nodes[p].ef));
    nodes[a.id] = { id: a.id, es, ef: es + a.duration, ls: 0, lf: 0, totalFloat: 0, critical: false };
  }
  const projectDuration = Math.max(0, ...Object.values(nodes).map((n) => n.ef));
  const successors = /* @__PURE__ */ new Map();
  for (const a of activities) for (const p of a.predecessors) successors.set(p, [...successors.get(p) ?? [], a.id]);
  for (const a of [...order].reverse()) {
    const succ = successors.get(a.id) ?? [];
    const lf = succ.length ? Math.min(...succ.map((s) => nodes[s].ls)) : projectDuration;
    const n = nodes[a.id];
    n.lf = lf;
    n.ls = lf - a.duration;
    n.totalFloat = n.ls - n.es;
    n.critical = Math.abs(n.totalFloat) < 1e-9;
  }
  const criticalPath2 = order.filter((a) => nodes[a.id].critical).map((a) => a.id);
  return { projectDuration, nodes, criticalPath: criticalPath2 };
}

// packages/engine/src/costs.ts
function penaltyFromPercent(contractValue, percentPerDay, capPercent) {
  return {
    penaltyPerDay: contractValue * percentPerDay,
    penaltyCap: capPercent === void 0 ? null : contractValue * capPercent
  };
}
function penaltyCost(delayDays, terms) {
  const chargeable = Math.max(0, delayDays - (terms.claimableDays ?? 0));
  const raw = chargeable * terms.penaltyPerDay;
  return terms.penaltyCap == null ? raw : Math.min(raw, terms.penaltyCap);
}
function unitDailyCost(c) {
  const labor = (c.operatorPerHour ?? 0) * (1 + (c.laborSurcharge ?? 0));
  return (c.rentalPerHour + labor + (c.fuelPerHour ?? 0) + (c.maintenancePerHour ?? 0)) * c.paidHoursPerDay;
}
function unitCostForDays(c, days2, includeMobilization) {
  const billable = Math.max(days2, c.minRentalDays ?? 0);
  return unitDailyCost(c) * billable + (includeMobilization ? c.mobilization ?? 0 : 0);
}
function presentValue(amount, days2, annualRate) {
  return amount / (1 + annualRate) ** (days2 / 365);
}
function formatMoney(amount, currency = "COP", locale = "es-CO") {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}
function formatMillions(amount) {
  const m = Math.abs(amount) / 1e6;
  const text = `$${m.toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`;
  return amount < -0.05 * 1e6 ? `\u2212${text}` : text;
}

// packages/engine/src/decision.ts
function evaluate(input, extra) {
  const totalUnits = input.currentUnits + extra;
  const dailyOutput = crewOutput(totalUnits, input.perUnitDaily, input.saturation);
  const duration = durationDays(input.pendingQty, dailyOutput);
  const delayDays = Math.max(0, duration - input.availableDays);
  const earlyDays = Math.max(0, input.availableDays - duration);
  const currentUnitsCost = input.includeCurrentUnitsCost === false ? 0 : input.currentUnits * unitCostForDays(input.unitCost, duration, false);
  const extraDirect = extra * unitCostForDays(input.unitCost, duration, true);
  const qualityCost = extra > 0 ? extraDirect * (input.quality?.expectedReworkPct ?? 0) + (input.quality?.extraInspectionPerDay ?? 0) * duration : 0;
  const accelerationCost = extraDirect + qualityCost;
  const penalty = penaltyCost(delayDays, input.contract);
  const indirect = input.contract.dailyIndirectCost * duration;
  const bonus = (input.contract.earlyBonusPerDay ?? 0) * earlyDays;
  const total = currentUnitsCost + accelerationCost + penalty + indirect - bonus;
  return {
    extraUnits: extra,
    totalUnits,
    dailyOutput,
    duration,
    delayDays,
    earlyDays,
    currentUnitsCost,
    accelerationCost,
    qualityCost,
    penalty,
    indirect,
    bonus,
    total
  };
}
function analyzeAcceleration(input) {
  const warnings = [];
  const maxBySpace = input.saturation?.maxUnits !== void 0 ? input.saturation.maxUnits - input.currentUnits : Infinity;
  const maxExtra = Math.max(0, Math.min(input.maxExtraUnits ?? 10, maxBySpace));
  if (maxBySpace < (input.maxExtraUnits ?? 10))
    warnings.push(`El frente admite como m\xE1ximo ${input.saturation.maxUnits} ${input.resourceName}.`);
  const raw = Array.from({ length: maxExtra + 1 }, (_, n) => evaluate(input, n));
  const baseTotal = raw[0].total;
  const points = raw.map((p) => ({ ...p, deltaVsBase: p.total - baseTotal }));
  const base = points[0];
  const best = points.reduce((a, b) => b.total < a.total - 1e-6 ? b : a);
  let breakEvenExtraUnits = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].total < points[i - 1].total) breakEvenExtraUnits = i;
    else break;
  }
  const r = input.resourceName;
  let breakEvenMessage;
  if (breakEvenExtraUnits === 0) {
    breakEvenMessage = `Agregar aunque sea 1 ${r} cuesta m\xE1s que lo que ahorra en multa e indirectos.`;
  } else {
    const p = points[breakEvenExtraUnits];
    const next = points[breakEvenExtraUnits + 1];
    breakEvenMessage = `Conviene acelerar hasta ${breakEvenExtraUnits} ${r} adicionales ` + (p.delayDays > 0 ? `(retraso de ${p.delayDays} d\xEDas)` : `(sin retraso${p.earlyDays ? `, ${p.earlyDays} d\xEDas de adelanto` : ""})`) + (next ? `; la siguiente unidad cuesta ${formatMillions(next.total - p.total)} m\xE1s de lo que evita.` : ".");
  }
  let recommendation;
  if (best.extraUnits === 0) {
    recommendation = base.delayDays > 0 ? `Acelerar cuesta m\xE1s que la multa: conviene aceptar ${base.delayDays} d\xEDas de retraso (multa ${formatMillions(base.penalty)}) y reclamar ampliaci\xF3n de plazo por las causales justificables.` : `Con los recursos actuales se cumple el plazo: no se requiere acelerar.`;
  } else {
    const avoided = base.penalty - best.penalty;
    const saving = -best.deltaVsBase;
    recommendation = `Acelerar con ${best.extraUnits} ${r} adicionales cuesta ${formatMillions(best.accelerationCost)} y evita ${formatMillions(avoided)} en multas y ${formatMillions(base.indirect - best.indirect)} en indirectos` + (input.includeCurrentUnitsCost === false ? "" : `, adem\xE1s de liberar antes los equipos actuales (${formatMillions(base.currentUnitsCost - best.currentUnitsCost)})`) + `: ahorro neto ${formatMillions(saving)}. Recomendado.`;
  }
  if (input.referencePerUnitDaily !== void 0) {
    const cmp = compareRates(input.referencePerUnitDaily, input.perUnitDaily, r);
    warnings.push(...cmp.warnings);
    if (cmp.ratio < 0.6 && best.extraUnits > 0)
      recommendation += ` Antes de movilizar, confirme el recurso limitante: si el problema es el acarreo o la compactaci\xF3n, reforzar ese eslab\xF3n puede lograr lo mismo a menor costo.`;
  }
  if (base.delayDays === 0) warnings.push("El escenario base ya cumple el plazo.");
  warnings.push("Acelerar no exime los controles de calidad ni SST: el costo de inspecci\xF3n y reproceso ya est\xE1 incluido.");
  return { base, points, best, breakEvenExtraUnits, recommendation, breakEvenMessage, warnings };
}
var DEFAULT_SENSITIVITY = [
  { name: "Rendimiento real 10 % menor", apply: (i) => ({ ...i, perUnitDaily: i.perUnitDaily * 0.9 }) },
  { name: "M\xE1s lluvia (\u221215 % de d\xEDas disponibles)", apply: (i) => ({ ...i, availableDays: Math.floor(i.availableDays * 0.85) }) },
  {
    name: "Alquiler 20 % m\xE1s caro",
    apply: (i) => ({ ...i, unitCost: { ...i.unitCost, rentalPerHour: i.unitCost.rentalPerHour * 1.2 } })
  },
  {
    name: "Multa 50 % menor",
    apply: (i) => ({ ...i, contract: { ...i.contract, penaltyPerDay: i.contract.penaltyPerDay * 0.5 } })
  }
];
function sensitivity(input, cases = DEFAULT_SENSITIVITY) {
  return cases.map((c) => {
    const r = analyzeAcceleration(c.apply(input));
    return {
      name: c.name,
      bestExtraUnits: r.best.extraUnits,
      bestTotal: r.best.total,
      netSaving: -r.best.deltaVsBase,
      baseDelay: r.base.delayDays
    };
  });
}

// packages/engine/src/pareto.ts
function pareto(items, threshold = 0.8) {
  const totals = /* @__PURE__ */ new Map();
  for (const it of items) if (it.value > 0) totals.set(it.key, (totals.get(it.key) ?? 0) + it.value);
  const grand = [...totals.values()].reduce((a, b) => a + b, 0);
  if (grand === 0) return [];
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let cum = 0;
  let reached = false;
  return sorted.map(([key, value]) => {
    const vital = !reached;
    cum += value;
    if (cum / grand >= threshold - 1e-9) reached = true;
    return { key, value, pct: value / grand, cumulativePct: cum / grand, vital };
  });
}
function lossPareto(records, metric, threshold = 0.8) {
  const value = (r) => {
    switch (metric) {
      case "lost_hours":
        return r.lostHours;
      case "lost_quantity":
        return r.lostHours * (r.hourlyRate ?? 0);
      case "lost_cost":
        return r.lostHours * (r.idleCostPerHour ?? 0);
      case "events":
        return r.lostHours > 0 ? 1 : 0;
    }
  };
  return pareto(
    records.filter((r) => r.cause !== "none").map((r) => ({ key: r.cause, value: value(r) })),
    threshold
  );
}
function claimableDays(records, claimableCauses, hoursPerDay) {
  const hours = records.filter((r) => claimableCauses.includes(r.cause)).reduce((a, r) => a + r.lostHours, 0);
  return Math.floor(hours / hoursPerDay);
}

// packages/engine/src/geo.ts
var EARTH_RADIUS = 6378137;
var rad = (d) => d * Math.PI / 180;
function ringArea(coords) {
  const n = coords.length;
  if (n <= 2) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p1 = coords[i];
    const p2 = coords[(i + 1) % n];
    const p3 = coords[(i + 2) % n];
    total += (rad(p3[0]) - rad(p1[0])) * Math.sin(rad(p2[1]));
  }
  return Math.abs(total * EARTH_RADIUS * EARTH_RADIUS / 2);
}
function polygonAreaM2(rings) {
  if (rings.length === 0) return 0;
  const [outer, ...holes] = rings;
  return holes.reduce((a, h) => a - ringArea(h), ringArea(outer));
}
function rectangle(a, b) {
  const [x1, y1] = a;
  const [x2, y2] = b;
  return [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]];
}
function solve3(m, v) {
  const A = m.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    if (Math.abs(A[col][col]) < 1e-12) throw new Error("Puntos de control colineales: elija puntos bien distribuidos");
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const k = A[r][col] / A[col][col];
      for (let c = col; c < 4; c++) A[r][c] -= k * A[col][c];
    }
  }
  return [0, 1, 2].map((i) => A[i][3] / A[i][i]);
}
function fitAffine(points) {
  if (points.length < 3) throw new Error("Se necesitan al menos 3 puntos de control");
  const N = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  for (const p of points) {
    const row = [p.px[0], p.px[1], 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) N[i][j] += row[i] * row[j];
      bx[i] += row[i] * p.geo[0];
      by[i] += row[i] * p.geo[1];
    }
  }
  const [a, b, c] = solve3(N, bx);
  const [d, e, f] = solve3(N, by);
  const tr = { a, b, c, d, e, f, rmseMeters: 0 };
  const sq = pointResiduals(tr, points).map((m) => m * m);
  tr.rmseMeters = Math.sqrt(sq.reduce((s, v) => s + v, 0) / sq.length);
  return tr;
}
function pointResiduals(t, points) {
  return points.map((p) => {
    const [lon, lat] = pixelToGeo(t, p.px);
    const dx = rad(lon - p.geo[0]) * EARTH_RADIUS * Math.cos(rad(p.geo[1]));
    const dy = rad(lat - p.geo[1]) * EARTH_RADIUS;
    return Math.hypot(dx, dy);
  });
}
function pixelToGeo(t, [x, y]) {
  return [t.a * x + t.b * y + t.c, t.d * x + t.e * y + t.f];
}
function imageCorners(t, width, height) {
  return [pixelToGeo(t, [0, 0]), pixelToGeo(t, [width, 0]), pixelToGeo(t, [width, height]), pixelToGeo(t, [0, height])];
}
function zoneStatus(executed, planned) {
  if (executed <= 0) return "not_started";
  return executed >= planned - 1e-9 ? "done" : "in_progress";
}
var ZONE_COLORS = {
  not_started: "#9CA3AF",
  in_progress: "#F59E0B",
  done: "#16A34A"
};

// packages/engine/src/alerts.ts
function findingAlerts(f, today, dueSoonDays = 2) {
  const out = [];
  if (f.status === "closed") return out;
  if (f.severity === "critical")
    out.push({ kind: "critical_finding", severity: "critical", title: "Hallazgo cr\xEDtico", body: f.description, refId: f.id });
  if (f.dueDate) {
    const days2 = Math.round((Date.parse(f.dueDate) - Date.parse(today)) / 864e5);
    if (days2 < 0)
      out.push({ kind: "overdue", severity: "high", title: "Pendiente vencido", body: `Venci\xF3 hace ${-days2} d\xEDas: ${f.description}`, refId: f.id });
    else if (days2 <= dueSoonDays)
      out.push({ kind: "due_soon", severity: "medium", title: "Pendiente por vencer", body: `Vence en ${days2} d\xEDas: ${f.description}`, refId: f.id });
  }
  return out;
}
function rateAlert(activityName, todayRate, historicalMean, requiredRate, tolerance = 0.8) {
  const ref = Math.max(historicalMean, requiredRate);
  if (ref <= 0 || todayRate >= ref * tolerance) return null;
  const which = requiredRate >= historicalMean ? "requerido" : "promedio";
  return {
    kind: "low_rate",
    severity: todayRate < ref * 0.5 ? "high" : "medium",
    title: "Rendimiento bajo",
    body: `${activityName}: ${todayRate.toFixed(1)}/d\xEDa, ${(todayRate / ref * 100).toFixed(0)} % del ${which} (${ref.toFixed(1)}/d\xEDa).`
  };
}
function noReportAlerts(fronts, today) {
  return fronts.filter((f) => f.lastReportDate !== today).map((f) => ({ kind: "no_report", severity: "medium", title: "Frente sin reporte", body: `${f.name} no tiene reporte hoy.`, refId: f.id }));
}
function staleSyncAlert(oldestPendingAt, now, maxHours = 12) {
  if (!oldestPendingAt) return null;
  const hours = (Date.parse(now) - Date.parse(oldestPendingAt)) / 36e5;
  if (hours <= maxHours) return null;
  return {
    kind: "stale_sync",
    severity: "high",
    title: "Registros sin sincronizar",
    body: `Hay registros pendientes de sincronizar desde hace ${Math.floor(hours)} horas.`
  };
}
function lateProjectionAlert(activityName, delayDays, finishDate) {
  if (delayDays === null || delayDays <= 0) return null;
  return {
    kind: "late_projection",
    severity: delayDays > 15 ? "critical" : delayDays > 5 ? "high" : "medium",
    title: "Proyecci\xF3n supera la fecha contractual",
    body: `${activityName} termina el ${finishDate}, ${delayDays} d\xEDas tarde.`
  };
}

// packages/engine/src/scenarios.ts
var DEFAULT_SHIFT_RULES = {
  productivity: [1, 0.85, 0.75],
  laborSurcharge: [0, 0.35, 0.35],
  extraShiftOverheadPerDay: 0
};
var ceilDays = (q, rate) => q <= 0 ? 0 : rate > 0 ? Math.ceil(q / rate - 1e-9) : Infinity;
var rulesOf = (sim) => sim.shifts ?? DEFAULT_SHIFT_RULES;
function activityDailyOutput(a, p, rules = DEFAULT_SHIFT_RULES) {
  const base = crewOutput(a.currentUnits + p.extraUnits, a.perUnitDaily, a.saturation);
  let factor = 0;
  for (let k = 0; k < p.shifts; k++) factor += rules.productivity[k] ?? 0;
  return base * factor;
}
function shiftDayCost(c, k, rules) {
  return unitDailyCost({ ...c, laborSurcharge: (c.laborSurcharge ?? 0) + (rules.laborSurcharge[k] ?? 0) });
}
function activityCosts(sim, a, p, d) {
  const rules = rulesOf(sim);
  if (!a.unitCost || d === 0 || !Number.isFinite(d)) return { currentCost: 0, accelerationCost: 0, qualityCost: 0 };
  const c = a.unitCost;
  const billable = Math.max(d, c.minRentalDays ?? 0);
  const firstShift = shiftDayCost(c, 0, rules);
  let allShifts = 0;
  for (let k = 0; k < p.shifts; k++) allShifts += shiftDayCost(c, k, rules);
  const currentCost = sim.includeCurrentUnitsCost === false ? 0 : a.currentUnits * firstShift * billable;
  const extraShifts = a.currentUnits * (allShifts - firstShift) * billable;
  const extraUnits = p.extraUnits * (allShifts * billable + (c.mobilization ?? 0));
  const overhead = (p.shifts - 1) * rules.extraShiftOverheadPerDay * d;
  const accelerationCost = extraShifts + extraUnits + overhead;
  const qualityCost = accelerationCost > 0 ? accelerationCost * (sim.quality?.expectedReworkPct ?? 0) + (sim.quality?.extraInspectionPerDay ?? 0) * d : 0;
  return { currentCost, accelerationCost, qualityCost };
}
function evaluatePlan(sim, plan, opts = {}) {
  const rules = rulesOf(sim);
  const acts = sim.activities;
  const pOf = (a) => plan[a.id] ?? { extraUnits: 0, shifts: 1 };
  const durations = new Map(acts.map((a) => [a.id, ceilDays(a.pendingQty, activityDailyOutput(a, pOf(a), rules))]));
  const ids = new Set(acts.map((a) => a.id));
  const cpm = criticalPath(
    acts.map((a) => ({
      id: a.id,
      // Sin rendimiento la duración es infinita: se excluye de la ruta crítica (compareScenarios lo advierte)
      duration: Number.isFinite(durations.get(a.id)) ? durations.get(a.id) : 0,
      predecessors: a.predecessors.filter((p) => ids.has(p))
    }))
  );
  const projectDuration = cpm.projectDuration;
  const delayDays = Math.max(0, projectDuration - sim.availableDays);
  const earlyDays = Math.max(0, sim.availableDays - projectDuration);
  const activities = acts.map((a) => {
    const d = durations.get(a.id);
    const node = cpm.nodes[a.id];
    return {
      id: a.id,
      name: a.name,
      plan: pOf(a),
      dailyOutput: activityDailyOutput(a, pOf(a), rules),
      duration: d,
      critical: node.critical && d > 0,
      totalFloat: node.totalFloat,
      ...activityCosts(sim, a, pOf(a), d)
    };
  });
  const sum = (k) => activities.reduce((s, x) => s + x[k], 0);
  const penalty = penaltyCost(delayDays, { ...sim.contract, claimableDays: opts.claim ? sim.contract.claimableDays ?? 0 : 0 });
  const indirect = sim.contract.dailyIndirectCost * projectDuration;
  const bonus = (sim.contract.earlyBonusPerDay ?? 0) * earlyDays;
  const currentResources = sum("currentCost");
  const acceleration = sum("accelerationCost");
  const quality = sum("qualityCost");
  const total = currentResources + acceleration + quality + penalty + indirect - bonus;
  let totalPV = null;
  const r = sim.annualDiscountRate;
  if (r && r > 0) {
    const mid = projectDuration / 2;
    totalPV = presentValue(currentResources + acceleration + quality + indirect, mid * (365 / 300), r) + presentValue(penalty - bonus, projectDuration * (365 / 300), r);
  }
  return {
    plan: Object.fromEntries(acts.map((a) => [a.id, pOf(a)])),
    projectDuration,
    delayDays,
    earlyDays,
    criticalPath: cpm.criticalPath.filter((id) => durations.get(id) > 0 && Number.isFinite(durations.get(id))),
    activities,
    currentResources,
    acceleration,
    quality,
    penalty,
    indirect,
    bonus,
    total,
    totalPV
  };
}
var basePlan = (sim) => Object.fromEntries(sim.activities.map((a) => [a.id, { extraUnits: 0, shifts: 1 }]));
function canAccelerate(a) {
  return Boolean(a.unitCost) && a.pendingQty > 0 && a.perUnitDaily > 0;
}
function moves(a, p) {
  const out = [];
  const maxExtra = (a.maxUnits ?? a.currentUnits + 10) - a.currentUnits;
  if (p.extraUnits < maxExtra) out.push({ ...p, extraUnits: p.extraUnits + 1 });
  if (p.shifts < (a.maxShifts ?? 1)) out.push({ ...p, shifts: p.shifts + 1 });
  return out;
}
function optimizeCriticalPath(sim, maxSteps = 200) {
  let plan = basePlan(sim);
  let current = evaluatePlan(sim, plan);
  const steps = [current];
  const curve = [{ delayDays: current.delayDays, projectDuration: current.projectDuration, total: current.total, step: "Recursos actuales" }];
  const byId = new Map(sim.activities.map((a) => [a.id, a]));
  for (let i = 0; i < maxSteps; i++) {
    let bestCand = null;
    for (const id of current.criticalPath) {
      const a = byId.get(id);
      if (!canAccelerate(a)) continue;
      for (const m of moves(a, plan[id])) {
        const r = evaluatePlan(sim, { ...plan, [id]: m });
        const shorter = r.projectDuration < current.projectDuration;
        const better = !bestCand ? true : shorter && bestCand.r.projectDuration >= current.projectDuration ? true : !shorter && bestCand.r.projectDuration < current.projectDuration ? false : r.total < bestCand.r.total;
        if (better) {
          const what = m.shifts > plan[id].shifts ? `${m.shifts}.\xBA turno` : `+1 ${a.resourceName ?? "unidad"}`;
          bestCand = { r, label: `${a.name}: ${what}` };
        }
      }
    }
    if (!bestCand) break;
    if (current.delayDays === 0 && bestCand.r.total >= current.total - 1e-6) break;
    plan = bestCand.r.plan;
    current = bestCand.r;
    steps.push(current);
    if (current.projectDuration < curve[curve.length - 1].projectDuration || current.total < curve[curve.length - 1].total)
      curve.push({ delayDays: current.delayDays, projectDuration: current.projectDuration, total: current.total, step: bestCand.label });
  }
  let best = steps.reduce((a, b) => b.total < a.total - 1e-6 ? b : a);
  best = relaxPlan(sim, best);
  return { best, curve, steps };
}
function relaxPlan(sim, start) {
  let current = start;
  let improved = true;
  while (improved) {
    improved = false;
    for (const a of sim.activities) {
      const p = current.plan[a.id];
      if (!p) continue;
      const options = [];
      if (p.extraUnits > 0) options.push({ ...p, extraUnits: p.extraUnits - 1 });
      if (p.shifts > 1) options.push({ ...p, shifts: p.shifts - 1 });
      for (const o of options) {
        const r = evaluatePlan(sim, { ...current.plan, [a.id]: o });
        if (r.delayDays <= current.delayDays && r.total < current.total - 1e-6) {
          current = r;
          improved = true;
          break;
        }
      }
    }
  }
  return current;
}
function uniformAcceleration(sim) {
  const base = evaluatePlan(sim, basePlan(sim));
  if (base.delayDays === 0) return base;
  const ratio3 = sim.availableDays / base.projectDuration;
  const rules = rulesOf(sim);
  const plan = basePlan(sim);
  for (const a of sim.activities) {
    if (!canAccelerate(a)) continue;
    const d0 = ceilDays(a.pendingQty, activityDailyOutput(a, plan[a.id], rules));
    const target = Math.max(1, Math.floor(d0 * ratio3));
    let chosen = null;
    const maxExtra = (a.maxUnits ?? a.currentUnits + 10) - a.currentUnits;
    for (let s = 1; s <= (a.maxShifts ?? 1); s++) {
      for (let e = 0; e <= maxExtra; e++) {
        const p = { extraUnits: e, shifts: s };
        const d = ceilDays(a.pendingQty, activityDailyOutput(a, p, rules));
        const c = activityCosts(sim, a, p, d);
        const cost = c.currentCost + c.accelerationCost + c.qualityCost;
        const ok = d <= target;
        if (!chosen || ok && (chosen.d > target || cost < chosen.cost) || !ok && chosen.d > target && d < chosen.d) chosen = { p, cost, d };
      }
    }
    if (chosen) plan[a.id] = chosen.p;
  }
  return evaluatePlan(sim, plan);
}
var SCENARIO_LABEL = {
  base: "Base: continuar igual",
  uniform: "Aceleraci\xF3n general",
  optimal: "Mixto: solo ruta cr\xEDtica",
  claim: "Aceptar multa y reclamar"
};
function describePlan(sim, r) {
  const out = [];
  for (const a of sim.activities) {
    const p = r.plan[a.id];
    if (!p || p.extraUnits === 0 && p.shifts === 1) continue;
    const parts = [];
    if (p.extraUnits > 0) parts.push(`+${p.extraUnits} ${a.resourceName ?? "unidad(es)"}`);
    if (p.shifts > 1) parts.push(`${p.shifts} turnos`);
    out.push(`${a.name}: ${parts.join(", ")}`);
  }
  return out;
}
function compareScenarios(sim) {
  const warnings = [];
  for (const a of sim.activities) {
    if (a.pendingQty <= 0) continue;
    if (!(a.perUnitDaily > 0)) warnings.push(`${a.name}: sin rendimiento (ni real ni de referencia); no se puede proyectar.`);
    else if (!a.unitCost) warnings.push(`${a.name}: sin recurso con costo en la biblioteca; no se considera acelerarla.`);
  }
  const base = evaluatePlan(sim, basePlan(sim));
  const claim = evaluatePlan(sim, basePlan(sim), { claim: true });
  const uniform = uniformAcceleration(sim);
  const opt = optimizeCriticalPath(sim);
  const scenarios = { base, uniform, optimal: opt.best, claim };
  const order = ["optimal", "claim", "uniform", "base"];
  const best = order.reduce((a, b) => scenarios[b].total < scenarios[a].total - 1e-6 ? b : a);
  let breakEven = null;
  if (opt.curve.length > 1) {
    const minIdx = opt.curve.reduce((bi, p, i, arr) => p.total < arr[bi].total ? i : bi, 0);
    const next = opt.curve[minIdx + 1];
    breakEven = { delayDays: opt.curve[minIdx].delayDays, total: opt.curve[minIdx].total, nextStepExtraCost: next ? next.total - opt.curve[minIdx].total : null };
  }
  const actions = describePlan(sim, opt.best);
  let recommendation;
  const claimDays = sim.contract.claimableDays ?? 0;
  if (base.delayDays === 0) {
    recommendation = `Con los recursos actuales la obra termina ${base.earlyDays} d\xEDa(s) antes de la fecha contractual: no se requiere acelerar.`;
  } else if (best === "optimal" && actions.length) {
    const s = scenarios.optimal;
    recommendation = `Acelerar solo la ruta cr\xEDtica (${actions.join("; ")}) cuesta ${formatMillions(s.acceleration + s.quality)} y evita ${formatMillions(base.penalty - s.penalty)} en multas y ${formatMillions(base.indirect - s.indirect)} en indirectos` + (sim.includeCurrentUnitsCost === false ? "" : `, adem\xE1s de liberar antes los recursos actuales`) + `: ahorro neto ${formatMillions(base.total - s.total)} frente a seguir igual` + (s.delayDays > 0 ? ` (queda un retraso de ${s.delayDays} d\xEDas).` : ".") + " Recomendado.";
  } else if (best === "claim") {
    recommendation = `Acelerar cuesta m\xE1s que la multa: conviene aceptar ${base.delayDays} d\xEDas de retraso` + (claimDays > 0 ? ` y reclamar ampliaci\xF3n de plazo por ${Math.min(claimDays, base.delayDays)} d\xEDas justificables (lluvia, permisos o cambios del cliente): multa estimada ${formatMillions(claim.penalty)}.` : ` (multa ${formatMillions(base.penalty)}). Documenta las causas imputables al cliente para reclamar.`);
  } else if (best === "uniform") {
    recommendation = `La aceleraci\xF3n general es la opci\xF3n de menor costo total (${formatMillions(uniform.total)}): ahorro ${formatMillions(base.total - uniform.total)} frente a seguir igual.`;
  } else {
    recommendation = `Ninguna aceleraci\xF3n evaluada mejora el costo total: continuar con los recursos actuales (retraso ${base.delayDays} d\xEDas, multa ${formatMillions(base.penalty)}).`;
  }
  if (opt.best.delayDays > 0 && base.delayDays > 0 && opt.steps[opt.steps.length - 1].delayDays > 0)
    warnings.push("Ni acelerando al m\xE1ximo (unidades y turnos permitidos) se elimina el retraso: revisa espacio del frente, turnos o un frente adicional.");
  warnings.push("Acelerar no exime los controles de calidad ni SST: el costo de inspecci\xF3n y reproceso ya est\xE1 incluido.");
  return { scenarios, best, curve: opt.curve, breakEven, recommendation, actions, warnings };
}
var PROJECT_SENSITIVITY = [
  { name: "Rendimiento real 10 % menor", apply: (s) => ({ ...s, activities: s.activities.map((a) => ({ ...a, perUnitDaily: a.perUnitDaily * 0.9 })) }) },
  { name: "M\xE1s lluvia (\u221215 % de d\xEDas disponibles)", apply: (s) => ({ ...s, availableDays: Math.floor(s.availableDays * 0.85) }) },
  {
    name: "Alquiler 20 % m\xE1s caro",
    apply: (s) => ({ ...s, activities: s.activities.map((a) => a.unitCost ? { ...a, unitCost: { ...a.unitCost, rentalPerHour: a.unitCost.rentalPerHour * 1.2 } } : a) })
  },
  { name: "Multa 50 % menor", apply: (s) => ({ ...s, contract: { ...s.contract, penaltyPerDay: s.contract.penaltyPerDay * 0.5 } }) },
  { name: "Multa 50 % mayor", apply: (s) => ({ ...s, contract: { ...s.contract, penaltyPerDay: s.contract.penaltyPerDay * 1.5 } }) }
];
function projectSensitivity(sim) {
  return PROJECT_SENSITIVITY.map((c) => {
    const r = compareScenarios(c.apply(sim));
    const best = r.scenarios[r.best];
    return { name: c.name, best: r.best, bestTotal: best.total, baseTotal: r.scenarios.base.total, saving: r.scenarios.base.total - best.total, baseDelay: r.scenarios.base.delayDays };
  });
}

// packages/engine/src/dashboard.ts
function plannedQtyAt(a, date, cal = {}) {
  if (!a.plannedStart || !a.plannedFinish) return 0;
  if (diffDays(a.plannedStart, date) < 0) return 0;
  if (diffDays(a.plannedFinish, date) >= 0) return a.contractQty;
  const total = workingDaysBetween(a.plannedStart, a.plannedFinish, cal);
  if (total <= 0) return a.contractQty;
  return a.contractQty * workingDaysBetween(a.plannedStart, date, cal) / total;
}
function recentDailyRate(daily, activityId, today, windowDays = 14, cal = {}) {
  const from = addDays(today, -(windowDays - 1));
  const qty = daily.filter((d) => d.activityId === activityId && d.date >= from && d.date <= today).reduce((s, d) => s + d.quantity, 0);
  const days2 = workingDaysBetween(from, today, cal);
  return days2 > 0 ? qty / days2 : 0;
}
function weighting(activities) {
  const acts = activities.filter((a) => a.contractQty > 0 && a.plannedStart && a.plannedFinish);
  const excluded = activities.filter((a) => !acts.includes(a)).map((a) => a.id);
  const weighted = acts.some((a) => a.weight != null);
  const raw = (a) => weighted ? a.weight ?? 0 : 1;
  const total = acts.reduce((s, a) => s + raw(a), 0) || 1;
  return { acts, excluded, weighted, w: (a) => raw(a) / total };
}
function sCurve(input) {
  const cal = input.calendar ?? {};
  const { acts, excluded, w } = weighting(input.activities);
  const maxExt = input.maxExtensionDays ?? 120;
  const window = input.rateWindowDays ?? 14;
  const dates = acts.flatMap((a) => [a.plannedStart, a.plannedFinish]);
  const lo = [input.from, input.today, addDays(input.today, -(window - 1)), ...dates].reduce((m, d) => d < m ? d : m);
  const hi = [addDays(input.to, maxExt + 1), input.today, ...dates].reduce((m, d) => d > m ? d : m);
  const wd = workdayCounter(cal, lo, hi);
  const byAct = /* @__PURE__ */ new Map();
  for (const d of input.daily) {
    if (!byAct.has(d.activityId)) byAct.set(d.activityId, []);
    byAct.get(d.activityId).push(d);
  }
  const sumUntil = (id, date) => (byAct.get(id) ?? []).reduce((s, d) => d.date <= date ? s + d.quantity : s, 0);
  const totalWd = new Map(acts.map((a) => [a.id, wd(a.plannedStart, a.plannedFinish)]));
  const plannedQty = (a, date) => {
    if (date < a.plannedStart) return 0;
    if (date >= a.plannedFinish) return a.contractQty;
    const total = totalWd.get(a.id);
    return total <= 0 ? a.contractQty : a.contractQty * wd(a.plannedStart, date) / total;
  };
  const planned = (date) => acts.reduce((s, a) => s + w(a) * (plannedQty(a, date) / a.contractQty), 0);
  const rateFrom = addDays(input.today, -(window - 1));
  const rateDays = wd(rateFrom, input.today);
  const rates = new Map(
    acts.map((a) => {
      const qty = (byAct.get(a.id) ?? []).reduce((s, d) => d.date >= rateFrom && d.date <= input.today ? s + d.quantity : s, 0);
      return [a.id, rateDays > 0 ? qty / rateDays : 0];
    })
  );
  const doneToday = new Map(acts.map((a) => [a.id, Math.min(a.contractQty, sumUntil(a.id, input.today))]));
  const units = /* @__PURE__ */ new Map();
  for (const a of acts) {
    const g = input.groupOf?.(a.id);
    const key = g ? `g:${g}` : `a:${a.id}`;
    if (!units.has(key)) units.set(key, { acts: [], W: 0, f: 0, r: 0, daysLeft: null });
    const u = units.get(key);
    u.acts.push(a);
    u.W += w(a);
  }
  for (const u of units.values()) {
    const W = u.W || 1;
    u.f = u.acts.reduce((t, a) => t + w(a) / W * (doneToday.get(a.id) / a.contractQty), 0);
    u.r = u.acts.reduce((t, a) => t + w(a) / W * (rates.get(a.id) / a.contractQty), 0);
    if (u.acts.length === 1) {
      const a = u.acts[0];
      const left = a.contractQty - doneToday.get(a.id);
      u.daysLeft = left <= 1e-9 ? 0 : rates.get(a.id) > 0 ? Math.ceil(left / rates.get(a.id) - 1e-9) : null;
    } else u.daysLeft = u.f >= 1 - 1e-9 ? 0 : u.r > 0 ? Math.ceil((1 - u.f) / u.r - 1e-9) : null;
  }
  const projected = (date) => {
    const days2 = date > input.today ? wd(addDays(input.today, 1), date) : 0;
    let s = 0;
    for (const u of units.values()) s += u.W * Math.min(1, u.f + u.r * days2);
    return s;
  };
  const actualAt = (date) => acts.reduce((s, a) => s + w(a) * Math.min(1, sumUntil(a.id, date) / a.contractQty), 0);
  const actualToday = actualAt(input.today);
  const plannedToday = planned(input.today);
  let projectedFinish = null;
  const pendingUnits = [...units.values()].filter((u) => u.daysLeft !== 0);
  const moving = pendingUnits.filter((u) => u.daysLeft != null);
  const stalled = pendingUnits.filter((u) => u.daysLeft == null).flatMap((u) => u.acts.filter((a) => doneToday.get(a.id) < a.contractQty - 1e-9).map((a) => a.id));
  if (pendingUnits.length === 0) projectedFinish = input.today;
  else if (moving.length) projectedFinish = addWorkingDays(addDays(input.today, 1), Math.max(...moving.map((u) => u.daysLeft)), cal);
  let end = input.to;
  if (projectedFinish && diffDays(end, projectedFinish) > 0) end = projectedFinish;
  if (diffDays(input.to, end) > maxExt) end = addDays(input.to, maxExt);
  if (!projectedFinish && diffDays(end, input.today) > 0) end = input.today;
  const cum = /* @__PURE__ */ new Map();
  const sorted = [...input.daily].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  let k = 0;
  const actualRunning = (date) => {
    for (; k < sorted.length && sorted[k].date <= date; k++) cum.set(sorted[k].activityId, (cum.get(sorted[k].activityId) ?? 0) + sorted[k].quantity);
    return acts.reduce((s, a) => s + w(a) * Math.min(1, (cum.get(a.id) ?? 0) / a.contractQty), 0);
  };
  const points = [];
  for (let d = input.from; diffDays(d, end) >= 0; d = addDays(d, 1)) {
    const past = d <= input.today;
    points.push({
      date: d,
      planned: planned(d),
      actual: past ? actualRunning(d) : null,
      // Une la proyección con el real en la fecha de hoy
      projected: d >= input.today ? d === input.today ? actualToday : projected(d) : null
    });
  }
  return { points, plannedToday, actualToday, spi: plannedToday > 0 ? actualToday / plannedToday : null, projectedFinish, stalled, excluded };
}
var LIGHT_LABEL = {
  green: "Al d\xEDa",
  amber: "En riesgo",
  red: "Atrasada",
  done: "Terminada",
  not_started: "Por iniciar",
  no_plan: "Sin programa"
};
var DEFAULT_THRESHOLDS = { redDelayDays: 3, amberGapPts: 5, redGapPts: 15 };
var fmt = (n) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });
function activityStatus(a, executedQty, dailyRate, today, cal = {}, th = DEFAULT_THRESHOLDS) {
  const qty = a.contractQty;
  const executed = Math.min(executedQty, qty);
  const plannedQty = plannedQtyAt(a, today, cal);
  const actualPct = qty > 0 ? executed / qty : 0;
  const plannedPct = qty > 0 ? plannedQty / qty : 0;
  const gapPts = (actualPct - plannedPct) * 100;
  const remaining = Math.max(0, qty - executed);
  const tomorrow = addDays(today, 1);
  let projectedFinish = null;
  if (remaining <= 1e-9) projectedFinish = today;
  else if (dailyRate > 0) projectedFinish = addWorkingDays(tomorrow, Math.ceil(remaining / dailyRate - 1e-9), cal);
  const delayDays = a.plannedFinish && projectedFinish ? diffDays(a.plannedFinish, projectedFinish) : null;
  let requiredRate = null;
  if (a.plannedFinish && remaining > 0) {
    const left = workingDaysBetween(tomorrow, a.plannedFinish, cal);
    requiredRate = left > 0 ? remaining / left : Infinity;
  }
  const base = { id: a.id, code: a.code, name: a.name, unit: a.unit, contractQty: qty, executedQty: executed, plannedQty, actualPct, plannedPct, gapPts, dailyRate, requiredRate, projectedFinish, delayDays };
  if (qty > 0 && remaining <= 1e-9) return { ...base, light: "done", reason: "Cantidad contractual completa." };
  if (!a.plannedStart || !a.plannedFinish) return { ...base, light: "no_plan", reason: "La actividad no tiene fechas programadas." };
  if (executed === 0 && diffDays(today, a.plannedStart) > 0)
    return { ...base, light: "not_started", reason: `Programada para iniciar el ${a.plannedStart}.` };
  const reqTxt = requiredRate === null ? "" : Number.isFinite(requiredRate) ? ` Se necesitan ${fmt(requiredRate)} ${a.unit}/d\xEDa y van ${fmt(dailyRate)}.` : " Ya pas\xF3 la fecha planeada de fin.";
  if (dailyRate <= 0)
    return { ...base, light: "red", reason: `Sin avance en los \xFAltimos d\xEDas y quedan ${fmt(remaining)} ${a.unit}.${reqTxt}` };
  if ((delayDays ?? 0) > th.redDelayDays || gapPts <= -th.redGapPts)
    return { ...base, light: "red", reason: `Al ritmo actual termina el ${projectedFinish}, ${delayDays} d\xEDa(s) despu\xE9s de lo planeado.${reqTxt}` };
  if ((delayDays ?? 0) > 0 || gapPts <= -th.amberGapPts)
    return {
      ...base,
      light: "amber",
      reason: (delayDays ?? 0) > 0 ? `Termina ${delayDays} d\xEDa(s) tarde al ritmo actual.${reqTxt}` : `Va ${fmt(-gapPts)} puntos por debajo del programa, pero el ritmo actual alcanza.`
    };
  return { ...base, light: "green", reason: delayDays !== null && delayDays < 0 ? `Termina ${-delayDays} d\xEDa(s) antes de lo planeado.` : "Avanza seg\xFAn el programa." };
}
function reportWeeks(from, to, cal = {}) {
  const dow = (d) => ((/* @__PURE__ */ new Date(`${d}T00:00:00Z`)).getUTCDay() + 6) % 7;
  const weeks = [];
  let start = addDays(from, -dow(from));
  for (let i = 1; diffDays(start, to) >= 0; i++, start = addDays(start, 7)) {
    const end = addDays(start, 6);
    let last = end;
    while (diffDays(start, last) > 0 && workingDaysBetween(last, last, cal) === 0) last = addDays(last, -1);
    weeks.push({ index: i, start, end, lastWorkday: last });
  }
  return weeks;
}
function weeklyProgress(input) {
  const cal = input.calendar ?? {};
  const { acts, weighted, w } = weighting(input.activities);
  const weeks = reportWeeks(input.from, input.to, cal);
  const inAvance = new Set(acts.map((a) => a.id));
  const byAct = /* @__PURE__ */ new Map();
  for (const d of input.daily) {
    if (!byAct.has(d.activityId)) byAct.set(d.activityId, []);
    byAct.get(d.activityId).push(d);
  }
  const dates = input.activities.flatMap((a) => a.plannedStart && a.plannedFinish ? [a.plannedStart, a.plannedFinish] : []);
  const lo = [input.from, weeks[0]?.start ?? input.from, ...dates].reduce((m, d) => d < m ? d : m);
  const hi = [input.to, weeks.at(-1)?.end ?? input.to, ...dates].reduce((m, d) => d > m ? d : m);
  const wd = workdayCounter(cal, lo, hi);
  const plannedQty = (a, date) => {
    if (!a.plannedStart || !a.plannedFinish || date < a.plannedStart) return 0;
    if (date >= a.plannedFinish) return a.contractQty;
    const total = wd(a.plannedStart, a.plannedFinish);
    return total <= 0 ? a.contractQty : a.contractQty * wd(a.plannedStart, date) / total;
  };
  const rows = input.activities.map((a) => {
    const mine = byAct.get(a.id) ?? [];
    const executed = weeks.map((wk) => mine.reduce((s, d) => d.date >= wk.start && d.date <= wk.end ? s + d.quantity : s, 0));
    const before = mine.reduce((s, d) => d.date < (weeks[0]?.start ?? "") ? s + d.quantity : s, 0);
    let running = before;
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      unit: a.unit,
      contractQty: a.contractQty,
      weight: inAvance.has(a.id) ? w(a) : 0,
      planned: weeks.map((wk) => a.contractQty > 0 ? plannedQty(a, wk.end) / a.contractQty : 0),
      actual: weeks.map((wk, i) => {
        running += executed[i];
        return wk.start > input.today ? null : a.contractQty > 0 ? Math.min(1, running / a.contractQty) : 0;
      }),
      executed
    };
  });
  const totalPlanned = weeks.map((_, i) => rows.reduce((s, r) => s + r.weight * r.planned[i], 0));
  const totalActual = weeks.map((_, i) => rows.some((r) => r.actual[i] === null) ? null : rows.reduce((s, r) => s + r.weight * (r.actual[i] ?? 0), 0));
  return { weeks, rows, totalPlanned, totalActual, weighted };
}

// packages/engine/src/dailyLog.ts
var toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
var toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
function mergeRain(intervals) {
  const sorted = intervals.map((i) => [toMin(i.start), toMin(i.end)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [a, b] of sorted) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return { intervals: merged.map(([a, b]) => ({ start: toHHMM(a), end: toHHMM(b) })), minutes: merged.reduce((s, [a, b]) => s + b - a, 0) };
}
function summarizeDailyLogs(logs) {
  const byDate = /* @__PURE__ */ new Map();
  for (const l of logs) byDate.set(l.date, [...byDate.get(l.date) ?? [], l]);
  const out = /* @__PURE__ */ new Map();
  for (const [date, ls] of byDate) {
    const personnel = {};
    const equipment = {};
    for (const l of ls) {
      for (const p of l.personnel) if (p.qty > 0) personnel[p.role] = (personnel[p.role] ?? 0) + p.qty;
      for (const e of l.equipment) if (e.qty > 0) equipment[e.name] = (equipment[e.name] ?? 0) + e.qty;
    }
    const rain = mergeRain(ls.flatMap((l) => l.rain));
    out.set(date, {
      date,
      personnel,
      equipment,
      totalPersonnel: Object.values(personnel).reduce((s, n) => s + n, 0),
      rain: rain.intervals,
      rainMinutes: rain.minutes,
      observations: ls.map((l) => l.observations?.trim() ?? "").filter(Boolean),
      reports: ls.length
    });
  }
  return out;
}
function rainInWindow(intervals, window) {
  const [ws, we] = [toMin(window.start), toMin(window.end)];
  return mergeRain(intervals).intervals.reduce((s, i) => s + Math.max(0, Math.min(we, toMin(i.end)) - Math.max(ws, toMin(i.start))), 0);
}
function weatherClaim(logs, entryHours, opts) {
  const rain = new Map([...logs].map((l) => [l.date, l.rain]));
  const dates = [.../* @__PURE__ */ new Set([...rain.keys(), ...entryHours.keys()])].sort();
  const days2 = [];
  for (const date of dates) {
    const intervals = rain.get(date) ?? [];
    const rainHours = rainInWindow(intervals, opts.window) / 60;
    const fromEntries = entryHours.get(date) ?? 0;
    const hours2 = Math.min(opts.effectiveHours, Math.max(rainHours, fromEntries));
    if (hours2 > 0) days2.push({ date, rain: intervals, rainHours, entryHours: fromEntries, hours: hours2 });
  }
  const hours = days2.reduce((s, d) => s + d.hours, 0);
  return { days: days2, hours, claimableDays: opts.effectiveHours > 0 ? Math.floor(hours / opts.effectiveHours + 1e-9) : 0 };
}

// packages/engine/src/control.ts
function activityControl(activities, entries, cutoff, cal = {}) {
  const valid = entries.filter((e) => e.date <= cutoff && (e.status === "submitted" || e.status === "approved"));
  const daily = valid.map((e) => ({ activityId: e.activityId, date: e.date, quantity: e.quantity }));
  return activities.map((a) => {
    const mine = valid.filter((e) => e.activityId === a.id);
    const reported = mine.reduce((t, e) => t + e.quantity, 0);
    const approved = mine.filter((e) => e.status === "approved").reduce((t, e) => t + e.quantity, 0);
    return {
      activity: a,
      status: activityStatus(a, reported, recentDailyRate(daily, a.id, cutoff, 14, cal), cutoff, cal),
      planned: plannedQtyAt(a, cutoff, cal),
      reported,
      approved,
      review: reported - approved,
      balance: Math.max(0, a.contractQty - approved)
    };
  });
}
function controlSummary(rows) {
  const { acts, w } = weighting(rows.map((r) => r.activity));
  const avg = (f) => acts.length ? acts.reduce((t, a) => t + w(a) * Math.min(1, f(rows.find((r) => r.activity.id === a.id)) / a.contractQty), 0) : null;
  const open = rows.filter((r) => r.status.light !== "done" && r.activity.contractQty > r.reported);
  const paced = open.filter((r) => r.status.requiredRate && r.status.requiredRate > 0 && Number.isFinite(r.status.requiredRate));
  const finishes = rows.map((r) => r.status.projectedFinish).filter((d) => !!d);
  const planned = rows.map((r) => r.activity.plannedFinish).filter((d) => !!d);
  const anyWithoutDate = open.some((r) => !r.status.projectedFinish);
  return {
    activities: rows.length,
    plannedPct: avg((r) => r.planned),
    executedPct: avg((r) => r.reported),
    approvedPct: avg((r) => r.approved),
    late: rows.filter((r) => r.status.light === "red").length,
    // Ya debía haber empezado (programado > 0) y no avanzó en 14 días
    stalled: open.filter((r) => r.status.dailyRate <= 0 && r.planned > 0).map((r) => r.activity.id),
    paceRatio: paced.length ? paced.reduce((t, r) => t + Math.min(2, r.status.dailyRate / r.status.requiredRate), 0) / paced.length : null,
    projectedFinish: anyWithoutDate || !finishes.length ? null : finishes.sort().at(-1),
    plannedFinish: planned.length ? planned.sort().at(-1) : null
  };
}

// packages/engine/src/production.ts
function costControl(i) {
  const es = i.entries.filter((e) => e.status === "submitted" || e.status === "approved");
  const reported = es.reduce((t, e) => t + e.quantity, 0);
  const approved = es.filter((e) => e.status === "approved").reduce((t, e) => t + e.quantity, 0);
  const hhProductive = es.reduce((t, e) => t + e.crewSize * e.effectiveHours, 0);
  const hhLost = es.reduce((t, e) => t + e.crewSize * e.lostHours, 0);
  const effective = es.reduce((t, e) => t + e.effectiveHours, 0);
  const lost = es.reduce((t, e) => t + e.lostHours, 0);
  const daysWorked = new Set(es.filter((e) => e.quantity > 0 || e.effectiveHours > 0).map((e) => e.date)).size;
  const labor = (hhProductive + hhLost) * i.laborCostPerHour;
  const equipment = i.equipmentDailyCost * daysWorked;
  const actual = labor + equipment + i.otherCost;
  const unit = i.budgetUnitCost;
  const realUnitCost = reported > 0 && actual > 0 ? actual / reported : null;
  const remainingQty = Math.max(0, i.contractQty - reported);
  const toComplete = remainingQty * (realUnitCost ?? unit ?? 0);
  const atCompletion = actual + toComplete;
  const realDailyRate = daysWorked ? reported / daysWorked : null;
  return {
    reported,
    approved,
    budget: unit == null ? null : unit * i.contractQty,
    earnedApproved: unit == null ? null : unit * approved,
    labor,
    equipment,
    other: i.otherCost,
    actual,
    hhProductive,
    hhLost,
    productivity: hhProductive > 0 ? reported / hhProductive : null,
    utilization: effective + lost > 0 ? effective / (effective + lost) : null,
    daysWorked,
    realDailyRate,
    rateVariance: realDailyRate != null && i.refDailyRate ? realDailyRate / i.refDailyRate - 1 : null,
    realUnitCost,
    remainingQty,
    toComplete,
    atCompletion,
    variance: unit == null ? null : unit * i.contractQty - atCompletion,
    cpi: unit != null && actual > 0 ? unit * reported / actual : null
  };
}

// packages/engine/src/planning.ts
var share = (a, executed) => a.contractQty > 0 ? Math.min(1, executed / a.contractQty) : 0;
var weightOf = (a) => a.weight ?? 1;
function weightedProgress(acts, executed) {
  const tw = acts.reduce((t, a) => t + weightOf(a), 0);
  return tw > 0 ? acts.reduce((t, a) => t + weightOf(a) * share(a, executed[a.id] ?? 0), 0) / tw : null;
}
function progressMatrix(acts, executed) {
  const inField = acts.filter((a) => a.subfield && a.group);
  const groups = [...new Set(inField.map((a) => a.group))];
  const subfields = [...new Set(inField.map((a) => a.subfield))].sort();
  const cells = {};
  for (const sf of subfields) {
    cells[sf] = {};
    for (const g of groups) {
      const list = inField.filter((a) => a.subfield === sf && a.group === g);
      if (list.length) cells[sf][g] = { pct: weightedProgress(list, executed) ?? 0, count: list.length };
    }
  }
  return { groups, subfields, cells };
}
var POSITION_RANK = { cabecera: 0, cuerpo: 1, cola: 2 };
function energizationReadiness(subfields, acts, executed, projectedFinish, today) {
  const rows = subfields.map((sf) => {
    const list = acts.filter((a) => a.subfield === sf.code);
    const open = list.filter((a) => share(a, executed[a.id] ?? 0) < 0.999);
    const dates = open.map((a) => projectedFinish[a.id] ?? null);
    const projectedReady = open.length === 0 ? today : dates.some((d) => d == null) ? null : dates.reduce((m, d) => d > m ? d : m, today);
    return {
      ...sf,
      pct: weightedProgress(list, executed) ?? 0,
      pending: open.length,
      ready: list.length > 0 && open.length === 0,
      projectedReady,
      delayDays: sf.planned && projectedReady && open.length ? diffDays(sf.planned, projectedReady) : null,
      blockers: [...new Set(open.filter((a) => projectedFinish[a.id] == null).map((a) => a.group ?? a.name))],
      sets: open.length && projectedReady ? open.find((a) => projectedFinish[a.id] === projectedReady)?.group ?? null : null
    };
  });
  const circuits = [...new Set(rows.map((r) => r.circuit ?? "Sin circuito"))].map((circuit) => {
    const list = rows.filter((r) => (r.circuit ?? "Sin circuito") === circuit).sort((a, b) => POSITION_RANK[a.position ?? "cuerpo"] - POSITION_RANK[b.position ?? "cuerpo"] || (a.order ?? 99) - (b.order ?? 99));
    const max = (xs) => xs.length === 0 || xs.some((x) => x == null) ? null : xs.reduce((m, x) => x > m ? x : m);
    return {
      circuit,
      subfields: list,
      ready: list.every((r) => r.ready),
      pct: list.reduce((t, r) => t + r.pct, 0) / (list.length || 1),
      planned: max(list.map((r) => r.planned)),
      baseline: max(list.map((r) => r.baseline)),
      projectedReady: max(list.map((r) => r.projectedReady)),
      blockers: [...new Set(list.flatMap((r) => r.blockers))],
      sets: list.find((r) => r.projectedReady && r.projectedReady === max(list.map((x) => x.projectedReady)))?.sets ?? null,
      firstOrder: Math.min(...list.map((r) => r.order ?? 99))
    };
  }).sort((a, b) => a.firstOrder - b.firstOrder);
  return { rows, circuits };
}
function weeklyKpi(acts, daily, today, weeks = 6) {
  const groups = [...new Set(acts.map((a) => a.group).filter(Boolean))];
  const byId = new Map(acts.map((a) => [a.id, a]));
  return groups.map((group) => {
    const list = acts.filter((a) => a.group === group);
    const units = [...new Set(list.map((a) => a.unit.trim().toLowerCase()))];
    const unit = units.length === 1 ? list[0].unit : null;
    const tw = list.reduce((t, a) => t + weightOf(a), 0) || 1;
    const measure = (a, q) => unit ? q : a.contractQty > 0 ? weightOf(a) / tw * (q / a.contractQty) : 0;
    const total = unit ? list.reduce((t, a) => t + a.contractQty, 0) : 1;
    const mine = daily.filter((d) => d.date <= today && byId.get(d.activityId)?.group === group);
    const executedRaw = mine.reduce((t, d) => t + measure(byId.get(d.activityId), d.quantity), 0);
    const executed = Math.min(total, executedRaw);
    const remaining = Math.max(0, total - executed);
    const series = Array.from({ length: weeks }, (_, i) => {
      const end = addDays(today, -7 * (weeks - 1 - i));
      const start = addDays(end, -6);
      return mine.filter((d) => d.date >= start && d.date <= end).reduce((t, d) => t + measure(byId.get(d.activityId), d.quantity), 0);
    });
    const lastWeek = series.at(-1) ?? 0;
    const avg3 = series.slice(-3).reduce((t, x) => t + x, 0) / Math.min(3, series.length || 1);
    const finishes = list.map((a) => a.plannedFinish).filter(Boolean);
    const plannedFinish = finishes.length ? finishes.reduce((m, d) => d > m ? d : m) : null;
    const done = remaining <= total * 1e-3;
    const daysLeft = plannedFinish ? diffDays(today, plannedFinish) : null;
    const requiredPerWeek = done ? 0 : daysLeft != null && daysLeft > 0 ? remaining / (daysLeft / 7) : null;
    return {
      group,
      unit,
      total,
      executed,
      remaining,
      weeks: series,
      lastWeek,
      avg3,
      plannedFinish,
      requiredPerWeek,
      kpi: requiredPerWeek ? lastWeek / requiredPerWeek : null,
      forecastFinish: done ? null : avg3 > 0 ? addDays(today, Math.ceil(remaining / avg3 * 7)) : null,
      done
    };
  });
}
function scheduleProgressRows(items, statusDate, cal = {}) {
  const rows = [];
  for (const it of items) {
    const target = Math.min(100, Math.max(0, it.pct)) / 100 * it.contractQty;
    const delta = target - it.executed;
    if (!(delta > 1e-9)) continue;
    const end = it.actualFinish && it.actualFinish < statusDate ? it.actualFinish : statusDate;
    let start = it.actualStart ?? end;
    if (it.lastRecorded && it.lastRecorded >= start) start = addDays(it.lastRecorded, 1);
    if (start > end) start = end;
    const days2 = [];
    for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkingDay(d, cal)) days2.push(d);
    if (!days2.length) days2.push(end);
    const each = Math.floor(delta / days2.length * 1e4) / 1e4;
    days2.forEach((date, i) => rows.push({ activityId: it.activityId, date, quantity: i === days2.length - 1 ? +(delta - each * (days2.length - 1)).toFixed(4) : each }));
  }
  return rows;
}
function mondayOf(d) {
  const dow = ((/* @__PURE__ */ new Date(`${d}T00:00:00Z`)).getUTCDay() + 6) % 7;
  return addDays(d, -dow);
}
function lookahead(activities, executed, weekStart, weeks = 3, cal = {}) {
  return activities.map((a) => {
    const remaining = Math.max(0, a.contractQty - (executed[a.id] ?? 0));
    let covered = executed[a.id] ?? 0;
    const plan = Array.from({ length: weeks }, (_, i) => {
      const target = Math.min(a.contractQty, plannedQtyAt(a, addDays(weekStart, 7 * i + 6), cal));
      const q = Math.max(0, target - covered);
      covered += q;
      return q;
    });
    return { activityId: a.id, weeks: plan, remaining };
  }).filter((r) => r.remaining > 1e-9 && r.weeks.some((q) => q > 1e-9));
}
function ppc(items) {
  const judged = items.filter((i) => i.done != null);
  return judged.length ? judged.filter((i) => i.done).length / judged.length : null;
}

// packages/engine/src/payments.ts
var money = (x) => Math.round(x * 100) / 100;
function paymentCertificate(items, opts = {}) {
  const missingPrice = items.filter((i) => i.unitPrice == null).map((i) => i.code);
  const lines = items.filter((i) => i.unitPrice != null).map((i) => {
    const price = i.unitPrice;
    const periodQty = i.cumulativeQty - i.previousQty;
    return {
      id: i.id,
      code: i.code,
      name: i.name,
      unit: i.unit,
      contractQty: i.contractQty,
      unitPrice: price,
      previousQty: i.previousQty,
      periodQty,
      cumulativeQty: i.cumulativeQty,
      contractAmount: money(i.contractQty * price),
      previousAmount: money(i.previousQty * price),
      periodAmount: money(periodQty * price),
      cumulativeAmount: money(i.cumulativeQty * price),
      balanceAmount: money((i.contractQty - i.cumulativeQty) * price),
      exceeds: i.cumulativeQty > i.contractQty + 1e-9
    };
  });
  const sum = (k) => money(lines.reduce((t, l) => t + l[k], 0));
  const retentionPct = opts.retentionPct ?? 0;
  const advancePct = opts.advancePct ?? 0;
  const periodAmount = sum("periodAmount");
  const contractAmount = sum("contractAmount");
  const cumulativeAmount = sum("cumulativeAmount");
  const adminPct = opts.adminPct ?? 0;
  const contingencyPct = opts.contingencyPct ?? 0;
  const utilityPct = opts.utilityPct ?? 0;
  const vatMode = opts.vatMode ?? "none";
  const vatPct = vatMode === "none" ? 0 : opts.vatPct ?? 0.19;
  const adminAmount = money(periodAmount * adminPct);
  const contingencyAmount = money(periodAmount * contingencyPct);
  const utilityAmount = money(periodAmount * utilityPct);
  const subtotalAmount = money(periodAmount + adminAmount + contingencyAmount + utilityAmount);
  const vatAmount = money((vatMode === "utility" ? utilityAmount : vatMode === "full" ? subtotalAmount : 0) * vatPct);
  const grossAmount = money(subtotalAmount + vatAmount);
  const retentionAmount = money(subtotalAmount * retentionPct);
  const advanceAmount = money(subtotalAmount * advancePct);
  const totals = {
    contractAmount,
    previousAmount: sum("previousAmount"),
    periodAmount,
    cumulativeAmount,
    balanceAmount: sum("balanceAmount"),
    retentionPct,
    retentionAmount,
    advancePct,
    advanceAmount,
    adminPct,
    adminAmount,
    contingencyPct,
    contingencyAmount,
    utilityPct,
    utilityAmount,
    subtotalAmount,
    vatMode,
    vatPct,
    vatAmount,
    grossAmount,
    netAmount: money(grossAmount - retentionAmount - advanceAmount),
    financialProgress: contractAmount > 0 ? cumulativeAmount / contractAmount : null
  };
  return { lines, totals, missingPrice };
}

// packages/engine/src/materials.ts
function materialStatus(materials, usage, activities, daily, deliveries, today, cal = {}, windowDays = 14) {
  const from = addDays(today, -(windowDays - 1));
  const workDays = Math.max(1, workingDaysBetween(from, today, cal));
  const qtyOf = new Map(activities.map((a) => [a.id, a.contractQty]));
  return materials.map((m) => {
    const uses = usage.filter((u) => u.materialId === m.id);
    const factor = new Map(uses.map((u) => [u.activityId, u.factor]));
    let consumed = 0;
    let recent = 0;
    for (const d of daily) {
      const f = factor.get(d.activityId);
      if (f == null || d.date > today) continue;
      consumed += d.quantity * f;
      if (d.date >= from) recent += d.quantity * f;
    }
    const required = uses.reduce((t, u) => t + (qtyOf.get(u.activityId) ?? 0) * u.factor, 0);
    const delivered = deliveries.filter((d) => d.materialId === m.id && d.date <= today).reduce((t, d) => t + d.quantity, 0);
    const stock = delivered - consumed;
    const pendingInstall = Math.max(0, required - consumed);
    const ratePerDay = recent / workDays;
    const daysLeft = ratePerDay > 0 ? Math.max(0, stock) / ratePerDay : null;
    const covered = pendingInstall <= Math.max(0, stock) + 1e-9;
    const status = covered ? "covered" : stock <= 1e-9 ? "out" : daysLeft != null && daysLeft < m.lowDays ? "low" : "ok";
    return {
      ...m,
      required,
      delivered,
      consumed,
      stock,
      pendingDelivery: Math.max(0, required - delivered),
      pendingInstall,
      ratePerDay,
      daysLeft,
      runOutDate: daysLeft != null && !covered ? addWorkingDays(addDays(today, 1), Math.max(1, Math.floor(daysLeft)), cal) : null,
      status
    };
  });
}

// packages/engine/src/evm.ts
var ratio = (a, b) => b > 0 ? a / b : null;
function parteCosts(days2, personnelRates, equipmentRates) {
  const items = [];
  const roles = /* @__PURE__ */ new Set();
  const equipment = /* @__PURE__ */ new Set();
  for (const d of days2) {
    let personal = 0;
    let equipos = 0;
    for (const [role, qty] of Object.entries(d.personnel)) {
      const r = personnelRates[role];
      if (r) personal += qty * r;
      else roles.add(role);
    }
    for (const [name, qty] of Object.entries(d.equipment)) {
      const r = equipmentRates[name];
      if (r) equipos += qty * r;
      else equipment.add(name);
    }
    if (personal) items.push({ date: d.date, amount: personal, source: "personal" });
    if (equipos) items.push({ date: d.date, amount: equipos, source: "equipos" });
  }
  return { items, unpricedRoles: [...roles].sort(), unpricedEquipment: [...equipment].sort() };
}
function sundayOf(d) {
  const dow = (/* @__PURE__ */ new Date(`${d}T12:00:00Z`)).getUTCDay();
  return addDays(d, dow === 0 ? 0 : 7 - dow);
}
function earnedValue(input) {
  const { activities, cutoff } = input;
  const cal = input.calendar ?? {};
  const budgeted = activities.filter((a) => a.budgetUnitCost != null && a.budgetUnitCost > 0 && a.contractQty > 0);
  const price = new Map(budgeted.map((a) => [a.id, a.budgetUnitCost]));
  const bac = budgeted.reduce((t, a) => t + a.contractQty * a.budgetUnitCost, 0);
  const firstDates = [
    ...budgeted.map((a) => a.plannedStart).filter((d) => !!d),
    ...input.approved.map((e) => e.date),
    ...input.costs.map((c) => c.date)
  ].filter((d) => d <= cutoff);
  const first = firstDates.length ? firstDates.reduce((a, b) => a < b ? a : b) : cutoff;
  const lastFinish = budgeted.reduce((m, a) => a.plannedFinish && a.plannedFinish > m ? a.plannedFinish : m, cutoff);
  const count = workdayCounter(cal, first < cutoff ? first : cutoff, lastFinish);
  const pvAt = (date) => {
    let pv2 = 0;
    for (const a of budgeted) {
      if (!a.plannedStart || !a.plannedFinish || date < a.plannedStart) continue;
      if (date >= a.plannedFinish) {
        pv2 += a.contractQty * a.budgetUnitCost;
        continue;
      }
      const total = count(a.plannedStart, a.plannedFinish);
      pv2 += (total > 0 ? a.contractQty * count(a.plannedStart, date) / total : a.contractQty) * a.budgetUnitCost;
    }
    return pv2;
  };
  const evByDate = /* @__PURE__ */ new Map();
  for (const e of input.approved) {
    const p = price.get(e.activityId);
    if (p && e.date <= cutoff) evByDate.set(e.date, (evByDate.get(e.date) ?? 0) + e.quantity * p);
  }
  const acByDate = /* @__PURE__ */ new Map();
  const acBySource = { personal: 0, equipos: 0, materiales: 0, subcontratos: 0, otros: 0 };
  for (const c of input.costs) {
    if (c.date > cutoff) continue;
    acByDate.set(c.date, (acByDate.get(c.date) ?? 0) + c.amount);
    acBySource[c.source] += c.amount;
  }
  const cumulative = (m) => {
    const dates = [...m.keys()].sort();
    let run = 0;
    const cum = dates.map((d) => run += m.get(d));
    return (date) => {
      let lo = 0;
      let hi = dates.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = lo + hi >> 1;
        if (dates[mid] <= date) idx = mid, lo = mid + 1;
        else hi = mid - 1;
      }
      return idx < 0 ? 0 : cum[idx];
    };
  };
  const evAt = cumulative(evByDate);
  const acAt = cumulative(acByDate);
  const ends = [];
  for (let d = sundayOf(first); d < cutoff; d = addDays(d, 7)) ends.push(d);
  ends.push(cutoff);
  const series = (input.weeks ? ends.slice(-input.weeks) : ends).map((date) => {
    const pv2 = pvAt(date);
    const ev2 = evAt(date);
    const ac2 = acAt(date);
    return { date, pv: pv2, ev: ev2, ac: ac2, spi: ratio(ev2, pv2), cpi: ratio(ev2, ac2) };
  });
  const now = series.at(-1);
  const { pv, ev, ac } = now;
  const spi = now.spi;
  const cpi = now.cpi;
  const eac = cpi ? bac / cpi : null;
  const readings = [];
  const pctTxt = (x) => `${Math.round(x * 100)} %`;
  const f2 = (x) => x.toFixed(2).replace(".", ",");
  if (bac === 0) readings.push("Sin costo presupuestado por actividad no hay valor ganado: c\xE1rgalo en Costos y productividad o en el Excel de la programaci\xF3n.");
  else if (budgeted.length < activities.length)
    readings.push(`Solo ${budgeted.length} de ${activities.length} actividades tienen costo presupuestado: el valor ganado no incluye las dem\xE1s.`);
  if (bac > 0 && ac === 0) readings.push("A\xFAn no hay costo real: pon tarifas al personal y equipos del parte, precios a los materiales o registra los costos.");
  if (spi != null && cpi != null) {
    if (cpi >= 1 && spi < 0.95)
      readings.push(`El costo se ve bien (CPI ${f2(cpi)}) pero el avance va atrasado (SPI ${f2(spi)}): se gast\xF3 menos porque se avanz\xF3 menos.`);
    else if (cpi < 0.95 && spi >= 1)
      readings.push(`Se va al d\xEDa o adelantado (SPI ${f2(spi)}) pero gastando de m\xE1s (CPI ${f2(cpi)}): revisa si se est\xE1 acelerando a un costo que no compensa.`);
    else if (cpi < 0.95 && spi < 0.95)
      readings.push(`Atrasado (SPI ${f2(spi)}) y con sobrecosto (CPI ${f2(cpi)}): cada $1 gastado produce $${f2(cpi)} de obra.`);
    else if (cpi >= 0.95 && spi >= 0.95) readings.push(`Plazo y costo dentro de lo previsto (SPI ${f2(spi)}, CPI ${f2(cpi)}).`);
  }
  const back = series.at(-5);
  if (back?.cpi != null && cpi != null && Math.abs(cpi - back.cpi) >= 0.05)
    readings.push(`El CPI ${cpi > back.cpi ? "mejor\xF3" : "empeor\xF3"} de ${f2(back.cpi)} a ${f2(cpi)} en las \xFAltimas 4 semanas.`);
  if (eac != null && bac > 0 && eac > bac * 1.02)
    readings.push(`Al ritmo de costo actual la obra costar\xEDa ${pctTxt(eac / bac - 1)} m\xE1s que el presupuesto.`);
  return {
    bac,
    budgetedActivities: budgeted.length,
    totalActivities: activities.length,
    pv,
    ev,
    ac,
    sv: ev - pv,
    cv: ev - ac,
    spi,
    cpi,
    eac,
    etc: eac != null ? Math.max(0, eac - ac) : null,
    vac: eac != null ? bac - eac : null,
    tcpi: bac - ac > 0 ? (bac - ev) / (bac - ac) : null,
    acBySource,
    series,
    readings
  };
}

// packages/engine/src/subcontractors.ts
var ratio2 = (a, b) => b > 0 ? a / b : null;
var days = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
function subcontractorScores(input) {
  const { cutoff } = input;
  const dated = input.activities.filter((a) => a.plannedStart && a.plannedFinish);
  const first = dated.reduce((m, a) => a.plannedStart < m ? a.plannedStart : m, cutoff);
  const last = dated.reduce((m, a) => a.plannedFinish > m ? a.plannedFinish : m, cutoff);
  const count = workdayCounter(input.calendar ?? {}, first, last);
  const plannedQty = (a) => {
    if (!a.plannedStart || !a.plannedFinish || cutoff < a.plannedStart) return 0;
    if (cutoff >= a.plannedFinish) return a.contractQty;
    const total = count(a.plannedStart, a.plannedFinish);
    return total > 0 ? a.contractQty * count(a.plannedStart, cutoff) / total : a.contractQty;
  };
  const approvedQty = /* @__PURE__ */ new Map();
  for (const e of input.approved) if (e.date <= cutoff) approvedQty.set(e.activityId, (approvedQty.get(e.activityId) ?? 0) + e.quantity);
  const fourWeeksAgo = addDays(cutoff, -28);
  return input.companyIds.map((companyId) => {
    const acts = input.activities.filter((a) => a.companyId === companyId);
    const priced = acts.filter((a) => a.unitPrice != null && a.unitPrice > 0);
    const value = (q) => priced.reduce((t, a) => t + q(a) * a.unitPrice, 0);
    const contractValue = value((a) => a.contractQty);
    const executedValue = value((a) => approvedQty.get(a.id) ?? 0);
    const plannedValue = value(plannedQty);
    const certs = input.certificates.filter((c) => c.companyId === companyId && c.periodEnd <= cutoff).sort((a, b) => b.number - a.number);
    const billed = certs[0]?.cumulativeAmount ?? 0;
    const retained = certs.reduce((t, c) => t + c.retentionAmount, 0);
    const items = input.planItems.filter((i) => i.companyId === companyId && i.done != null && i.weekStart >= fourWeeksAgo && i.weekStart <= cutoff);
    const ppc2 = ratio2(items.filter((i) => i.done).length, items.length);
    const nc = input.findings.filter((f) => f.companyId === companyId && (f.category === "no_conformidad" || f.category === "punch"));
    const open = nc.filter((f) => f.status !== "closed");
    const overdue = open.filter((f) => f.dueDate != null && f.dueDate < cutoff);
    const closed = nc.filter((f) => f.status === "closed" && f.closedAt);
    const ncCloseDays = closed.length ? closed.reduce((t, f) => t + days(f.createdAt, f.closedAt), 0) / closed.length : null;
    const spi = ratio2(executedValue, plannedValue);
    const reasons = [];
    let red = false;
    let amber = false;
    if (spi != null && spi < 0.85) red = true, reasons.push(`Atrasado: ejecut\xF3 ${Math.round(spi * 100)} % de lo programado a la fecha.`);
    else if (spi != null && spi < 0.95) amber = true, reasons.push(`Algo atrasado: ${Math.round(spi * 100)} % de lo programado.`);
    if (overdue.length >= 3) red = true, reasons.push(`${overdue.length} no conformidades vencidas sin cerrar.`);
    else if (overdue.length > 0) amber = true, reasons.push(`${overdue.length} no conformidad(es) vencida(s).`);
    if (ppc2 != null && ppc2 < 0.6) red = true, reasons.push(`Cumple solo el ${Math.round(ppc2 * 100)} % de lo que compromete en el plan semanal.`);
    else if (ppc2 != null && ppc2 < 0.8) amber = true, reasons.push(`Plan semanal cumplido al ${Math.round(ppc2 * 100)} %.`);
    const toBill = Math.max(0, executedValue - billed);
    if (contractValue > 0 && toBill > contractValue * 0.1) amber = true, reasons.push("Tiene m\xE1s del 10 % del contrato ejecutado y aprobado sin facturar.");
    if (priced.length < acts.length) reasons.push(`${acts.length - priced.length} actividad(es) sin precio de subcontrato: no entran en los valores.`);
    return {
      companyId,
      activities: acts.length,
      priced: priced.length,
      contractValue,
      executedValue,
      plannedValue,
      progress: ratio2(executedValue, contractValue),
      spi,
      billed,
      toBill,
      retained,
      lastCertificate: certs[0]?.number ?? null,
      ppc: ppc2,
      planItems: items.length,
      ncOpen: open.length,
      ncOverdue: overdue.length,
      ncCloseDays,
      status: red ? "red" : amber ? "amber" : "green",
      reasons
    };
  });
}

// packages/engine/src/compliance.ts
var COMPANY_DOCS = {
  pila: "Planilla de seguridad social (PILA)",
  arl_empresa: "Afiliaci\xF3n ARL de la empresa",
  poliza: "P\xF3liza",
  sg_sst: "SG-SST (est\xE1ndares m\xEDnimos)",
  camara_comercio: "C\xE1mara de comercio"
};
var WORKER_DOCS = {
  arl: "Afiliaci\xF3n ARL",
  eps: "Afiliaci\xF3n EPS",
  pension: "Afiliaci\xF3n a pensi\xF3n",
  examen_medico: "Examen m\xE9dico ocupacional",
  induccion: "Inducci\xF3n SST de la obra",
  alturas: "Curso de trabajo seguro en alturas",
  espacios_confinados: "Curso de espacios confinados",
  licencia: "Licencia de conducci\xF3n",
  certificado_operador: "Certificado de operador de equipo"
};
var REQUIRED_COMPANY_DOCS = ["pila"];
var REQUIRED_WORKER_DOCS = ["arl", "eps", "examen_medico", "induccion"];
function docState(expiresOn, today, soonDays = 15) {
  if (!expiresOn) return "ok";
  if (expiresOn < today) return "expired";
  return expiresOn <= addDays(today, soonDays) ? "soon" : "ok";
}
function latestByType(docs) {
  const out = /* @__PURE__ */ new Map();
  for (const d of docs) {
    if (!out.has(d.docType)) out.set(d.docType, d.expiresOn);
    else {
      const prev = out.get(d.docType);
      if (prev !== null && (d.expiresOn === null || d.expiresOn > prev)) out.set(d.docType, d.expiresOn);
    }
  }
  return out;
}
function evaluate2(required, docs, today, soonDays) {
  const latest = latestByType(docs);
  const missing = required.filter((t) => !latest.has(t));
  const expired = required.filter((t) => latest.has(t) && docState(latest.get(t), today, soonDays) === "expired");
  const soon = required.filter((t) => latest.has(t) && docState(latest.get(t), today, soonDays) === "soon").map((t) => ({ docType: t, expiresOn: latest.get(t) }));
  return { status: missing.length || expired.length ? "blocked" : soon.length ? "soon" : "ok", missing, expired, soon };
}
function workerCompliance(worker, docs, today, soonDays = 15) {
  const required = [...REQUIRED_WORKER_DOCS, ...worker.worksAtHeight ? ["alturas"] : []];
  return evaluate2(required, docs, today, soonDays);
}
function companyCompliance(docs, today, soonDays = 15) {
  return evaluate2(REQUIRED_COMPANY_DOCS, docs, today, soonDays);
}
var docLabel = (t) => COMPANY_DOCS[t] ?? WORKER_DOCS[t] ?? t;
export {
  COMPANY_DOCS,
  DEFAULT_SENSITIVITY,
  DEFAULT_SHIFT_RULES,
  DEFAULT_THRESHOLDS,
  LIGHT_LABEL,
  MIN_SAMPLES_FOR_RELIABLE,
  PROJECT_SENSITIVITY,
  REQUIRED_COMPANY_DOCS,
  REQUIRED_WORKER_DOCS,
  SCENARIO_LABEL,
  WORKER_DOCS,
  ZONE_COLORS,
  activityControl,
  activityDailyOutput,
  activityStatus,
  addDays,
  addWorkingDays,
  analyzeAcceleration,
  availableDays,
  bottleneck,
  claimableDays,
  colombianHolidays,
  companyCompliance,
  compareRates,
  compareScenarios,
  controlSummary,
  costControl,
  crewOutput,
  criticalPath,
  describePlan,
  diffDays,
  docLabel,
  docState,
  durationDays,
  earnedValue,
  easterSunday,
  energizationReadiness,
  evaluatePlan,
  findingAlerts,
  fitAffine,
  formatDate,
  formatMillions,
  formatMoney,
  historicalRate,
  imageCorners,
  isWorkingDay,
  lateProjectionAlert,
  lookahead,
  lossPareto,
  materialStatus,
  mergeRain,
  mondayOf,
  noReportAlerts,
  optimizeCriticalPath,
  pareto,
  parseDate,
  parteCosts,
  paymentCertificate,
  penaltyCost,
  penaltyFromPercent,
  pixelToGeo,
  plannedQtyAt,
  pointResiduals,
  polygonAreaM2,
  ppc,
  presentValue,
  progressMatrix,
  projectCompletion,
  projectSensitivity,
  rainInWindow,
  rateAlert,
  recentDailyRate,
  rectangle,
  referenceDailyRate,
  reportWeeks,
  requiredEquipment,
  sCurve,
  scheduleProgressRows,
  sensitivity,
  staleSyncAlert,
  subcontractorScores,
  summarizeDailyLogs,
  uniformAcceleration,
  unitCostForDays,
  unitDailyCost,
  unitEfficiency,
  weatherClaim,
  weeklyKpi,
  weeklyProgress,
  weightedProgress,
  weighting,
  workdayCounter,
  workerCompliance,
  workingDaysBetween,
  zoneStatus
};
