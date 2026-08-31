import * as assert from "assert";
import { calculateRehab, calculateNetEquity, calculateMAO, isUnderwater, checkCriticalRisk } from "./underwriting/underwriter";

console.log("=========================================");
console.log("🧪 INICIANDO PRUEBAS UNITARIAS DE UNDERWRITER 🧪");
console.log("=========================================");

try {
  // 1. Test calculateRehab
  console.log("Running test: calculateRehab...");
  
  // Caso 1: Sin metraje, sin palabras clave (debería usar metraje base 1400 y tarifa base 25)
  // Rehab = 1400 * 25 * 1.15 = 40250
  const rehab1 = calculateRehab(null, []);
  assert.strictEqual(rehab1, 40250, `Esperado 40250, recibido ${rehab1}`);

  // Caso 2: Metraje especificado (1000 sqFt), sin palabras clave
  // Rehab = 1000 * 25 * 1.15 = 28750
  const rehab2 = calculateRehab(1000, []);
  assert.strictEqual(rehab2, 28750, `Esperado 28750, recibido ${rehab2}`);

  // Caso 3: Daño moderado ("boarded" o "electrical")
  // Rehab = 1000 * 45 * 1.15 = 51750
  const rehab3 = calculateRehab(1000, ["electrical"]);
  assert.strictEqual(rehab3, 51750, `Esperado 51750, recibido ${rehab3}`);

  // Caso 4: Daño severo ("structural" o "roof")
  // Rehab = 1000 * 65 * 1.15 = 74750
  const rehab4 = calculateRehab(1000, ["structural"]);
  assert.strictEqual(rehab4, 74750, `Esperado 74750, recibido ${rehab4}`);

  console.log("✅ calculateRehab passed!");

  // 2. Test calculateNetEquity
  console.log("\nRunning test: calculateNetEquity...");
  const equity1 = calculateNetEquity(200000, 80000, 20000, 5000);
  assert.strictEqual(equity1, 95000, `Esperado 95000, recibido ${equity1}`);
  
  const equity2 = calculateNetEquity(150000, 160000, 0, 0);
  assert.strictEqual(equity2, -10000, `Esperado -10000, recibido ${equity2}`);
  
  console.log("✅ calculateNetEquity passed!");

  // 3. Test calculateMAO
  console.log("\nRunning test: calculateMAO...");
  // ARV = 200000, rehab = 30000, mortgages = 10000, liens = 5000
  // MAO = (200000 * 0.70) - 30000 - (200000 * 0.03) - 15000 = 140000 - 30000 - 6000 - 15000 = 89000
  const mao1 = calculateMAO(200000, 30000, 10000, 5000);
  assert.strictEqual(mao1, 89000, `Esperado 89000, recibido ${mao1}`);

  // MAO no debería ser menor a 0
  const mao2 = calculateMAO(100000, 90000, 50000, 10000);
  assert.strictEqual(mao2, 0, `Esperado 0, recibido ${mao2}`);

  console.log("✅ calculateMAO passed!");

  // 4. Test isUnderwater
  console.log("\nRunning test: isUnderwater...");
  assert.strictEqual(isUnderwater(100000, 120000, 0, 0), true);
  assert.strictEqual(isUnderwater(100000, 80000, 10000, 5000), false);
  assert.strictEqual(isUnderwater(100000, 80000, 25000, 0), true);
  console.log("✅ isUnderwater passed!");

  // 5. Test checkCriticalRisk
  console.log("\nRunning test: checkCriticalRisk...");
  const risk1 = checkCriticalRisk(100000, 120000, 0, "BANK OF AMERICA", "12C01-1234", 0);
  // Debería marcar riesgo porque está underwater
  assert.ok(risk1.reasons.some(r => r.includes("bajo el agua")), "Debería mencionar deuda que supera el valor (bajo el agua)");

  const risk2 = checkCriticalRisk(100000, 50000, 0, "ASSOCIATION", "12C01-1234", 0);
  // Debería marcar riesgo porque el demandante indica posible Junior Lien
  assert.strictEqual(risk2.isRisk, true, "Debería marcar riesgo por Junior Lien");
  assert.ok(risk2.reasons.some(r => r.includes("Junior Lien")), "Debería mencionar Junior Lien");

  console.log("✅ checkCriticalRisk passed!");

  console.log("\n=========================================");
  console.log("🎉 TODAS LAS PRUEBAS PASARON CON ÉXITO 🎉");
  console.log("=========================================");
} catch (err: any) {
  console.error("\n❌ PRUEBA FALLIDA:", err.message);
  process.exit(1);
}
