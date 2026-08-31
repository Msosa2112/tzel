const testNames = [
  'UNKNOWN SPOUSE, IF ANY, OF LAFRONIA LESLIE, ET AL.',
  'UNKNOWN HEIRS AND DEVISEES OF HERBERT GIBBS, ET AL.',
  'THE UNKNOWN HEIRS OF SANDRA T. BOLTON, ET AL.',
  'UNKNOWN SPOUSE, IF ANY, OF MARY KELCY, ET AL.',
  'UNKNOWN DEFENDANTS WHO ARE THE HEIRS, DEVISEES, OR LEGATEES OF DETRAH L. DAVIS, ET AL.',
  'UNKNOWN HEIRS, DEVISEES, LEGATEES, BENEFICIARIES TO THE ESTATE OF TERESA KINSLOW, AKA TERESA ANN KINSLOW, ET AL.',
  'UNKNOWN HEIRS AND DEVISEES OF ANTONE LABAN PRUNTY, ET AL.',
  'UNKNOWN HEIRS, LEGATEES AND DEVISEES OF DIANE V. BURTON, ET AL.',
  'UNKNOWN HEIRS OF RICHARD BRIAN, ET AL.',
  'UNKNOWN HEIRS/DEVISEES/LEGATES/BENEFICIARIES OF JAMES W. CHURCHILL, JR. (DECEASED), ET AL.',
  'UNKNOWN SPOUSE, IF ANY, OF LEIGH A. LANGLEY, ET AL.'
];

export function cleanLegalOwnerName(rawName: string): string {
  if (!rawName) return rawName;
  let clean = rawName.trim();
  
  // 1. Remove trailing ET AL
  clean = clean.replace(/,\s*ET\s+AL\.?/gi, '').replace(/\s+ET\s+AL\.?/gi, '');
  
  // 2. Heirs of / Estate of / Spouse of regex
  const regexPatterns = [
    /UNKNOWN\s+(?:SPOUSE|HEIRS|DEVISEES|LEGATEES|BENEFICIARIES|DEFENDANTS)[^]*?\b(?:OF|TO THE ESTATE OF)\s+([^,]+?)(?:,|\s+AKA|\s*\(DECEASED\)|$)/i,
    /THE\s+UNKNOWN\s+HEIRS\s+OF\s+([^,]+?)(?:,|\s+AKA|\s*\(DECEASED\)|$)/i,
    /ESTATE\s+OF\s+([^,]+?)(?:,|\s+AKA|\s*\(DECEASED\)|$)/i
  ];

  for (const regex of regexPatterns) {
    const match = clean.match(regex);
    if (match && match[1]) {
      let extracted = match[1].trim().replace(/\s+AKA.*$/i, '').replace(/,\s*$/, '').replace(/\(DECEASED\)/gi, '').trim();
      if (extracted.length > 2) {
        if (/SPOUSE/i.test(clean)) {
          return `${extracted} (Cónyuge / Titular)`;
        }
        return `${extracted} (Sucesión / Heirs)`;
      }
    }
  }

  return clean;
}

testNames.forEach(n => console.log(n, '\n  ===>', cleanLegalOwnerName(n)));
