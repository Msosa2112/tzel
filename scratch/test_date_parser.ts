const MONTH_MAP: { [key: string]: number } = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11
};

function parseAuctionDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const clean = dateStr.toLowerCase().replace(/\s+/g, " ").trim();
  
  if (clean.includes("unknown") || clean.includes("pending")) {
    return null;
  }
  
  // 1. Formato MM/DD/YYYY o M/D/YYYY
  const slashDateMatch = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashDateMatch) {
    const month = parseInt(slashDateMatch[1], 10) - 1;
    const day = parseInt(slashDateMatch[2], 10);
    const year = parseInt(slashDateMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }
  
  // 2. Formato Month/DD YYYY (ej. "may/28 2026" o "july/ 2 2026")
  const monthSlashDayMatch = clean.match(/^([a-z]+)\s*\/\s*(\d{1,2})\s+(\d{4})$/);
  if (monthSlashDayMatch) {
    const monthName = monthSlashDayMatch[1];
    const day = parseInt(monthSlashDayMatch[2], 10);
    const year = parseInt(monthSlashDayMatch[3], 10);
    if (MONTH_MAP[monthName] !== undefined) {
      const d = new Date(year, MONTH_MAP[monthName], day);
      if (!isNaN(d.getTime())) return d;
    }
  }
  
  // 3. Formato Month DD, YYYY (ej. "february 12, 2026")
  const monthCommaMatch = clean.match(/^([a-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (monthCommaMatch) {
    const monthName = monthCommaMatch[1];
    const day = parseInt(monthCommaMatch[2], 10);
    const year = parseInt(monthCommaMatch[3], 10);
    if (MONTH_MAP[monthName] !== undefined) {
      const d = new Date(year, MONTH_MAP[monthName], day);
      if (!isNaN(d.getTime())) return d;
    }
  }
  
  // 4. Formato Month DD YYYY (ej. "july 7 2026")
  const monthSpaceMatch = clean.match(/^([a-z]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (monthSpaceMatch) {
    const monthName = monthSpaceMatch[1];
    const day = parseInt(monthSpaceMatch[2], 10);
    const year = parseInt(monthSpaceMatch[3], 10);
    if (MONTH_MAP[monthName] !== undefined) {
      const d = new Date(year, MONTH_MAP[monthName], day);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Fallback para constructor nativo de JavaScript
  const fallbackDate = new Date(dateStr);
  if (!isNaN(fallbackDate.getTime())) {
    return fallbackDate;
  }
  
  return null;
}

function isAuctionDateValid(dateStr: string): boolean {
  const auctionDate = parseAuctionDate(dateStr);
  if (!auctionDate) {
    console.log(`[DATE WARNING] No se pudo parsear la fecha de subasta: "${dateStr}". Se permitirá para revisión manual.`);
    return true; 
  }
  
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalizar a medianoche
  
  auctionDate.setHours(0, 0, 0, 0); // Normalizar la fecha de subasta a medianoche
  
  return auctionDate.getTime() >= today.getTime();
}

console.log("=== INICIANDO PRUEBAS DE PARSING Y VIGENCIA DE FECHAS ===");
console.log(`Fecha actual del sistema: ${new Date().toDateString()}`);

const tests = [
  { date: "06/25/2026", desc: "Futura (Kentucky)" },
  { date: "05/10/2026", desc: "Pasada (Kentucky)" },
  { date: "MAY/28 2026", desc: "Pasada (Indiana Clark)" },
  { date: "JULY/ 2 2026", desc: "Futura (Indiana Clark)" },
  { date: "August 13, 2026", desc: "Futura (Indiana Floyd)" },
  { date: "January 15, 2026", desc: "Pasada (Indiana Floyd)" },
  { date: "Unknown Date 2026", desc: "No parseable (Debería permitir)" }
];

for (const t of tests) {
  const parsed = parseAuctionDate(t.date);
  const valid = isAuctionDateValid(t.date);
  console.log(`\nInput: "${t.date}" (${t.desc})`);
  console.log(`Parsed Date: ${parsed ? parsed.toDateString() : "null"}`);
  console.log(`Válida (¿No ha pasado?): ${valid ? "SÍ (Mantener)" : "NO (Descartar)"}`);
}
