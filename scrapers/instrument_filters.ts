export const EXECUTION_ZONE = [
  "LIS PENDENS",
  "AMENDED LIS PENDENS",
  "ASGN LIS PENDEN",
  "LIS PENDENS STATE",
  "LIS PENDING METRO"
];

export const FINANCIAL_DISTRESS = [
  "MORTGAGE",
  "MTG ELEC REGIST",
  "DELINQUENT TAX",
  "CERT OF DELINQU",
  "CERT OF DELINQU MULTI",
  "FEDERAL LIEN",
  "JUDGMENT LIEN",
  "JUDGMENT LIEN METRO",
  "JUDGMENT LIEN STATE",
  "MECHANICS LIEN"
];

export const PHYSICAL_DISTRESS = [
  "BOARDING LIEN",
  "BLDG & HOUSING",
  "CITY LIEN"
];

export const PROBATE = [
  "WILL",
  "AFF OF DESCENT",
  "INHERT LIEN"
];

export const RELEASES = [
  "RELEASE",
  "BLANKET RELEASE",
  "PARTIAL RELEASE",
  "REL LIS PENDENS",
  "RELASE LIS PENDENS STATE",
  "REL FL MTG/DED",
  "REL CERTF DELQ",
  "REL CITY LIEN",
  "REL JUD LIEN METRO"
];

export const CRITICAL_INSTRUMENTS = {
  EXECUTION_ZONE,
  FINANCIAL_DISTRESS,
  PHYSICAL_DISTRESS,
  PROBATE,
  RELEASES
};

/**
 * Compara dos fechas en formato string.
 * Retorna true si releaseDate es posterior a debtDate.
 */
export function isDischargeInstrument(debtDateStr: string, releaseDateStr: string): boolean {
  if (!debtDateStr || !releaseDateStr) return false;
  
  const parseDate = (dStr: string): Date | null => {
    try {
      const clean = dStr.toLowerCase().replace(/\s+/g, " ").trim();
      
      // Formato MM/DD/YYYY o M/D/YYYY
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(clean)) {
        const [m, d, y] = clean.split("/").map(Number);
        return new Date(y, m - 1, d);
      }
      
      // Formato YYYY-MM-DD
      if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(clean)) {
        const [y, m, d] = clean.split("-").map(Number);
        return new Date(y, m - 1, d);
      }
      
      // General Date parse
      const parsed = Date.parse(clean);
      if (!isNaN(parsed)) {
        return new Date(parsed);
      }
    } catch (e) {}
    return null;
  };

  const debtDate = parseDate(debtDateStr);
  const releaseDate = parseDate(releaseDateStr);
  
  if (debtDate && releaseDate) {
    return releaseDate.getTime() > debtDate.getTime();
  }
  return false;
}
