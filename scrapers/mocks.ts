// Datos de simulación de alta fidelidad para gravámenes de escrituras (KY/IN)
export const DEEDS_SIMULATED_RECORDS: { [key: string]: any } = {
  // === JEFFERSON, KY ===
  "456 Oak St": {
    mortgages: [{ amount: 150000.00, lender: "JPMORGAN CHASE BANK", released: false }],
    taxLiens: [{ amount: 4800.00, plaintiff: "Jefferson County Sheriff", priority: "First" }],
    wills: [{ deceased: "CHARLES MILLER", executor: "MARY MILLER", docNumber: "W-2026-904" }]
  },
  "2303 W. Chestnut St. 40211": {
    mortgages: [{ amount: 95000.00, lender: "STOCK YARDS BANK", released: false }],
    taxLiens: [{ amount: 3500.00, plaintiff: "Jefferson County Clerk", priority: "Second" }],
    wills: []
  },
  "2715 W. Kentucky St. 40211": {
    mortgages: [{ amount: 65000.00, lender: "REPUBLIC BANK", released: false }],
    taxLiens: [{ amount: 1200.00, plaintiff: "Louisville Metro Revenue", priority: "First" }],
    wills: []
  },
  "4716 S. 3rd Street 40214": {
    mortgages: [{ amount: 110000.00, lender: "PNC BANK", released: false }],
    taxLiens: [{ amount: 5600.00, plaintiff: "KY Department of Revenue", priority: "First" }],
    wills: []
  },
  
  // === OLDHAM, KY ===
  "7508 East Orchard Grass Blvd., Crestwood, KY 40014": {
    mortgages: [{ amount: 185000.00, lender: "LAKEVIEW LOAN SERVICING", released: false }],
    taxLiens: [{ amount: 2400.00, plaintiff: "Oldham County Sheriff", priority: "First" }],
    wills: []
  },
  "101 Maple Ln, La Grange, KY 40031": {
    mortgages: [{ amount: 120000.00, lender: "US BANK NA", released: false }],
    taxLiens: [{ amount: 3100.00, plaintiff: "Oldham County Treasurer", priority: "First" }],
    wills: [{ deceased: "ROBERT DAVIS", executor: "JOHN DAVIS", docNumber: "W-26-4411" }]
  },

  // === BULLITT, KY ===
  "303 Cedar Ct, Shepherdsville, KY 40165": {
    mortgages: [{ amount: 90000.00, lender: "NATIONSTAR MORTGAGE", released: false }],
    taxLiens: [{ amount: 1800.00, plaintiff: "Bullitt County Clerk", priority: "First" }],
    wills: []
  },

  // === SHELBY, KY ===
  "505 Elm Rd, Shelbyville, KY 40065": {
    mortgages: [{ amount: 140000.00, lender: "CHASE MORTGAGE", released: false }],
    taxLiens: [{ amount: 3400.00, plaintiff: "Shelby County Clerk", priority: "First" }],
    wills: []
  },

  // === CLARK, IN ===
  "606 Willow Way, Jeffersonville, IN 47130": {
    mortgages: [{ amount: 115000.00, lender: "PNC BANK", released: false }],
    taxLiens: [{ amount: 4200.00, plaintiff: "Clark County Treasurer", priority: "First" }],
    wills: [],
    releases: [{ docType: "REL CERTF DELQ", fileDate: "2025-12-01" }]
  },
  "8312 LAUREL SPRINGS DRIVE, CHARLESTOWN": {
    mortgages: [{ amount: 80000.00, lender: "FIFTH THIRD BANK", released: false }],
    taxLiens: [{ amount: 2800.00, plaintiff: "Clark County Clerk", priority: "First" }],
    wills: []
  },

  // === FLOYD, IN ===
  "808 Poplar Pl, New Albany, IN 47150": {
    mortgages: [{ amount: 135000.00, lender: "FIFTH THIRD BANK", released: false }],
    taxLiens: [{ amount: 3900.00, plaintiff: "Floyd County Treasurer", priority: "First" }],
    wills: []
  },
  "1220 BEECHWOOD AVE, NEW ALBANY": {
    mortgages: [{ amount: 75000.00, lender: "PNC BANK", released: false }],
    taxLiens: [{ amount: 1500.00, plaintiff: "Floyd County Sheriff", priority: "Second" }],
    wills: []
  },

  // === HARRISON, IN ===
  "111 Ash Cir, Corydon, IN 47112": {
    mortgages: [{ amount: 80000.00, lender: "REGIONS BANK", released: false }],
    taxLiens: [{ amount: 2100.00, plaintiff: "Harrison County Treasurer", priority: "First" }],
    wills: []
  },
  "4187 Albin Ford Rd Se, New Middletown, IN 47160": {
    mortgages: [{ amount: 72000.00, lender: "US BANK", released: false }],
    taxLiens: [{ amount: 1100.00, plaintiff: "Harrison County Clerk", priority: "First" }],
    wills: []
  }
};

// Base de datos de dueños predefinidos para pruebas consistentes
export const PRESET_OWNERS: { [key: string]: { name: string; mailingAddress?: string } } = {
  "4030 beech": { name: "Sarah Jenkins", mailingAddress: "1254 Ocean Dr, Miami, FL 33139" },
  "705 hazel": { name: "Robert Miller", mailingAddress: "705 Hazel St 1, Louisville, KY 40211" },
  "6618 daytona": { name: "Michael Moore", mailingAddress: "1098 Lakeshore Dr, Orlando, FL 32801" },
  "1347 cypress": { name: "David Taylor", mailingAddress: "1347 Cypress, Louisville, KY 40211" },
  "1223 tile factory": { name: "William Anderson", mailingAddress: "1223 Tile Factory, Louisville, KY 40213" },
  "2605 w madison": { name: "Mary Smith", mailingAddress: "2605 W Madison, Louisville, KY 40211" },
  "4913 southside": { name: "James Johnson", mailingAddress: "4913 Southside, Louisville, KY 40214" },
  "2123 dumesnil": { name: "Patricia Williams", mailingAddress: "2123 Dumesnil, Louisville, KY 40210" },
  "2730 w chestnut": { name: "Thomas Davis", mailingAddress: "2730 W Chestnut, Louisville, KY 40211" },
  "203 n 37th": { name: "Linda Brown", mailingAddress: "884 Peachtree St, Atlanta, GA 30309" },
  "2332 magazine": { name: "Charles Jones", mailingAddress: "2332 Magazine, Louisville, KY 40211" },
  "3011 river park": { name: "Richard Garcia", mailingAddress: "3011 River Park, Louisville, KY 40211" },
  "2528 wyckford": { name: "Donald Lopez", mailingAddress: "994 Austin St, San Antonio, TX 78201" },
  "2330 magazine": { name: "Steven Wilson", mailingAddress: "2330 Magazine, Louisville, KY 40211" },
  "2314 w market": { name: "Joseph Martinez", mailingAddress: "2314 W Market, Louisville, KY 40212" }
};
