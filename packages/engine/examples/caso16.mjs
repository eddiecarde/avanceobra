// Imprime el caso obligatorio (punto 16) paso a paso. Uso: npm run caso16 -w @avanceobra/engine
import {
  analyzeAcceleration, compareRates, formatMillions, referenceDailyRate, requiredEquipment, sensitivity,
} from "../dist/index.js";

const pendingQty = 30000, availableDays = 40, units = 3;
const refPerUnit = referenceDailyRate({ name: "Excavadora", unit: "m³", refRatePerHour: 120, effectiveHoursPerDay: 8, availability: 0.85 });
const realPerUnit = pendingQty / (availableDays + 20) / units;

const input = {
  activityName: "Excavación", resourceName: "excavadoras", unit: "m³", pendingQty, availableDays,
  currentUnits: units, perUnitDaily: realPerUnit, referencePerUnitDaily: refPerUnit,
  saturation: { fullEfficiencyUnits: 4, decay: 0.8, maxUnits: 6 },
  unitCost: { rentalPerHour: 180000, operatorPerHour: 25000, fuelPerHour: 50000, paidHoursPerDay: 10, mobilization: 3500000 },
  contract: { penaltyPerDay: 5000000, penaltyCap: null, dailyIndirectCost: 4000000 },
  quality: { expectedReworkPct: 0.02 },
};

const n = (x, d = 1) => x.toLocaleString("es-CO", { maximumFractionDigits: d });
const reqRef = requiredEquipment({ pendingQty, availableDays, perUnitDaily: refPerUnit, currentUnits: units, resourceName: "excavadoras" });
const reqReal = requiredEquipment({ pendingQty, availableDays, perUnitDaily: realPerUnit, currentUnits: units, resourceName: "excavadoras", saturation: input.saturation });
const cmp = compareRates(refPerUnit, realPerUnit, "excavadoras");
const r = analyzeAcceleration(input);

console.log("CASO PUNTO 16 — MOVIMIENTO DE TIERRAS\n");
console.log(`1. Rendimiento requerido: 30.000 ÷ 40 = ${n(reqRef.requiredDailyRate)} m³/día`);
console.log(`2. Referencia por excavadora: 120 × 8 × 0,85 = ${n(refPerUnit)} m³/día → ${reqRef.message}`);
console.log(`3. Real implícito en 20 días de retraso: 30.000 ÷ 60 = 500 m³/día (${n(realPerUnit)} por excavadora)`);
console.log(`   ⚠ ${cmp.warnings[0]}`);
console.log(`4. Equipos necesarios con el ritmo real: ${n(reqReal.theoreticalUnits, 2)} → ${reqReal.message}`);
reqReal.warnings.forEach((w) => console.log(`   ⚠ ${w}`));
console.log(`5. Multa base: ${r.base.delayDays} días × $5.000.000 = ${formatMillions(r.base.penalty)}\n`);
console.log("6. Curva de costo (supuestos de costo ESTIMADOS, editables):");
console.log("   +exc  días  retraso  equipos act.  aceleración   multa     indirectos   TOTAL       vs base");
for (const p of r.points) {
  console.log(`   ${String(p.extraUnits).padStart(4)}  ${String(p.duration).padStart(4)}  ${String(p.delayDays).padStart(7)}  ` +
    [p.currentUnitsCost, p.accelerationCost, p.penalty, p.indirect, p.total, p.deltaVsBase].map((v) => formatMillions(v).padStart(11)).join(" ") +
    (p === r.best ? "  ← mínimo" : ""));
}
console.log(`\n7. Punto de equilibrio: ${r.breakEvenMessage}`);
console.log(`8. Recomendación: ${r.recommendation}`);
r.warnings.forEach((w) => console.log(`   ⚠ ${w}`));
console.log("\n9. Sensibilidad:");
for (const s of sensitivity(input)) console.log(`   - ${s.name}: óptimo +${s.bestExtraUnits}, ahorro neto ${formatMillions(s.netSaving)}`);
