export function extractStateFromAddress(address: string): string | null {
  if (!address) return null;
  const addrUpper = address.toUpperCase();
  
  // Match state code before zip code: e.g. "KY 40215" or "WV 25430-2773"
  const zipMatch = addrUpper.match(/\b([A-Z]{2})\b\s*\d{5}/);
  if (zipMatch) {
    return zipMatch[1];
  }
  
  // Match state code after a comma: e.g. ", KY" or ", KY,"
  const commaMatch = addrUpper.match(/,\s*([A-Z]{2})\b/);
  if (commaMatch) {
    return commaMatch[1];
  }
  
  // Match state code at the end of the string: e.g. "LOUISVILLE KY"
  const endMatch = addrUpper.match(/\b([A-Z]{2})\b\s*$/);
  if (endMatch) {
    return endMatch[1];
  }
  
  return null;
}

export function isAddressInJurisdiction(address: string, defaultState?: string): boolean {
  if (!address) return false;
  
  const extractedState = extractStateFromAddress(address);
  if (extractedState) {
    return extractedState === "KY" || extractedState === "IN";
  }
  
  if (defaultState) {
    const dsUpper = defaultState.toUpperCase().trim();
    return dsUpper === "KY" || dsUpper === "IN";
  }
  
  return true;
}
