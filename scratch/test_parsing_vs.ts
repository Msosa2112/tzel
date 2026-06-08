function cleanDefendant(name: string): string {
  if (!name) return "";
  let clean = name;
  
  // Remover texto entre paréntesis
  clean = clean.replace(/\([^)]*\)/g, "");
  
  // Remover et al, et al., et. al., etal
  clean = clean.replace(/,?\s+et\.?\s*al\.?/gi, "");
  clean = clean.replace(/,?\s+etal/gi, "");
  
  // Remover "spouse of", "and spouse", "husband/wife of", etc.
  clean = clean.replace(/,?\s+spouse\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+and\s+spouse.*$/gi, "");
  clean = clean.replace(/,?\s+husband\s+and\s+wife.*$/gi, "");
  clean = clean.replace(/,?\s+wife\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+husband\s+of\s+.*$/gi, "");
  
  // Remover "deceased" o "individually"
  clean = clean.replace(/,?\s+deceased/gi, "");
  clean = clean.replace(/,?\s+individually/gi, "");
  
  // Limpiar caracteres de puntuación sobrantes al final
  clean = clean.replace(/[\*\,\-\_\#\s]+$/, "");
  
  // Quitar comillas
  clean = clean.replace(/["']/g, "");
  
  // Normalizar espacios
  clean = clean.replace(/\s+/g, " ").trim();
  
  return clean;
}

function extractDefendant(caseStyle: string): { plaintiff: string | null, defendant: string | null } {
  const vsRegex = /\s+vs\.?\s+/i;
  if (vsRegex.test(caseStyle)) {
    const parts = caseStyle.split(vsRegex);
    if (parts.length >= 2) {
      const plaintiff = parts[0].trim();
      const defendant = cleanDefendant(parts[1]);
      return { plaintiff, defendant };
    }
  }
  return { plaintiff: null, defendant: null };
}

// Casos de prueba
const testCases = [
  "US Bank National Association vs. John Doe",
  "Deutsche Bank vs. Jane Smith, et al.",
  "Wells Fargo Bank vs. Robert Johnson, spouse of Sarah Johnson",
  "Fifth Third Bank vs. Michael Brown (deceased)",
  "PNC Bank vs. Lisa Davis, LLC",
  "NATIONSTAR MORTGAGE LLC vs. JUAN PEREZ, ET AL.",
  "MIDFIRST BANK vs. MARIA GOMEZ AND SPOUSE",
  "US BANK vs. ESTATE OF CHARLES SMITH, DECEASED",
  "LAKEVIEW LOAN SERVICING vs. KAREN WILSON (INDIVIDUALLY)",
  "JPMORGAN CHASE BANK vs. DAVID MILLER, AND SPOUSE JANE MILLER"
];

console.log("=== INICIANDO PRUEBAS DE EXTRACCIÓN DE DEMANDADO ===");
for (const tc of testCases) {
  const result = extractDefendant(tc);
  console.log(`\nOriginal: "${tc}"`);
  console.log(`Plaintiff: "${result.plaintiff}"`);
  console.log(`Defendant: "${result.defendant}"`);
}
console.log("\n================================================");
