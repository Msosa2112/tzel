import * as assert from "assert";
import { classifyConstructionItem } from "../classifiers/gemini_construction_classifier";
import { initConstructionSchema, saveConstructionBid, saveConstructionLead } from "../db_construction";
import { ConstructionBid, ConstructionLead } from "../types";

console.log("===============================================================");
console.log("🧪 INICIANDO PRUEBAS UNITARIAS: MÓDULO DE CONSTRUCCIÓN (TZEL) 🧪");
console.log("===============================================================");

async function runTests() {
  try {
    // 1. Test Database Schema Initialization
    console.log("1. Verificando inicialización de tablas SQL...");
    await initConstructionSchema();
    console.log("✅ Esquema de base de datos verificado con éxito.");

    // 2. Test Gemini Classifier: Aprobación de Obra Válida (Obra Nueva / Techos / Pavimentación)
    console.log("\n2. Probando clasificación de Licitación de Obra Válida...");
    const validBid = await classifyConstructionItem(
      "Louisville Community Center Roof Replacement and Facade Renovation",
      "Removal of existing asphalt shingles and installation of new 60-mil TPO single-ply roofing membrane with full facade brick repointing and gutters.",
      "Louisville Metro Procurement"
    );
    console.log("Resultado Obra Válida:", validBid);
    assert.strictEqual(validBid.isValidConstruction, true, "Debe ser aprobada como obra válida");
    console.log("✅ Obra de construcción aprobada correctamente.");

    // 3. Test Gemini Classifier: Rechazo Estricto de Contrato Mecánico / HVAC / Vehicular
    console.log("\n3. Probando descarte estricto de Contrato Mecánico/Vehicular...");
    const invalidMechanical = await classifyConstructionItem(
      "Fleet Maintenance and Diesel Engine Repair for City Garbage Trucks",
      "Routine oil changes, brake pads replacement, transmission overhaul, and diesel engine tune-ups for municipal public works vehicles.",
      "Louisville Fleet Services"
    );
    console.log("Resultado Contrato Mecánico:", invalidMechanical);
    assert.strictEqual(invalidMechanical.isValidConstruction, false, "Debe ser rechazada por ser mecánica vehicular");
    console.log("✅ Contrato mecánico descartado correctamente.");

    // 4. Test Mock Lead Storage
    console.log("\n4. Probando inserción y persistencia en Base de Datos...");
    const testBid: ConstructionBid = {
      bidId: "TEST_BID_KY_001",
      title: "Test Municipal Sidewalk Paving",
      agency: "Louisville Public Works",
      jurisdiction: "Louisville_Metro_KY",
      category: "CONCRETE_ASPHALT_PAVING",
      estimatedBudget: 75000,
      bidDeadline: "2026-09-30",
      solicitationUrl: "https://louisvilleky.gov/test-bid",
      description: "Prueba unitaria de inserción de licitación de pavimentación.",
      bondingRequired: true
    };
    const bidSaved = await saveConstructionBid(testBid);
    assert.strictEqual(bidSaved, true, "La licitación de prueba debe guardarse");

    const testLead: ConstructionLead = {
      leadId: "TEST_LEAD_001",
      category: "FOUNDATION_WATERPROOFING",
      triggerEvent: "MSD_BASEMENT_FLOOD",
      address: "123 Test St",
      county: "Jefferson",
      state: "KY",
      ownerName: "Juan Perez",
      ownerPhones: ["502-555-0199"],
      ownerEmails: ["juan@test.com"],
      propertyType: "Residential",
      estimatedProjectValue: 12000,
      urgencyLevel: "HIGH",
      sourcePortal: "MSD Flood Reports",
      rawDetails: "Prueba de lead de sótano con humedad.",
      insurancePayerLikely: true
    };
    const leadSaved = await saveConstructionLead(testLead);
    assert.strictEqual(leadSaved, true, "El lead de prueba debe guardarse");
    console.log("✅ Datos de prueba persistidos con éxito en Turso DB.");

    console.log("\n===============================================================");
    console.log("🎉 TODAS LAS PRUEBAS DEL MÓDULO DE CONSTRUCCIÓN PASARON 🎉");
    console.log("===============================================================");
  } catch (err: any) {
    console.error("\n❌ PRUEBA FALLIDA:", err.message);
    process.exit(1);
  }
}

runTests();
