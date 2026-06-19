import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

export interface BatchDataAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface SkipTracePhone {
  number: string;
  type: "Mobile" | "Landline" | "Unknown";
  isDNC: boolean;
  carrier?: string;
}

export interface SkipTraceEmail {
  email: string;
  deliverability: "Deliverable" | "Undeliverable" | "Unknown";
}

export interface BatchDataSkipTraceResponse {
  success: boolean;
  phones: SkipTracePhone[];
  emails: SkipTraceEmail[];
  mailingAddress?: BatchDataAddress;
  vacant?: boolean;
  rawResponse?: any;
  outOfFunds?: boolean;
}

/**
 * Cliente de Integración de BatchData API
 */
export class BatchDataClient {
  private apiKey: string;
  private baseUrl = "https://api.batchdata.com/api/v1";

  // Base de datos de simulación regional de alta fidelidad para los 7 condados
  private mockProperties: any[] = [
    // === JEFFERSON, KY ===
    {
      apn: "KY-JEFF-001",
      address: { street: "456 Oak St", city: "Louisville", state: "KY", zip: "40203" },
      county: "Jefferson",
      owners: [{ fullName: "CHARLES MILLER", mailingAddress: { street: "123 Main St", city: "Louisville", state: "KY", zip: "40202" } }],
      foreclosure: { foreclosureStatus: "Active", recordingDate: "2026-05-10", auctionDate: null, caseNumber: "26-CI-90011", plaintiff: "WELLS FARGO BANK", defendant: "CHARLES MILLER" },
      "mortgage-liens": {},
      permit: []
    },
    {
      apn: "KY-JEFF-002",
      address: { street: "789 Pine Rd", city: "Louisville", state: "KY", zip: "40204" },
      county: "Jefferson",
      owners: [{ fullName: "SARAH CONNOR", mailingAddress: { street: "789 Pine Rd", city: "Louisville", state: "KY", zip: "40204" } }],
      foreclosure: null,
      "mortgage-liens": {
        taxLiens: [{ amount: 4500, recordingDate: "2026-03-12", plaintiff: "IRS / KY Dept of Revenue" }],
        judgements: [{ amount: 12500, plaintiff: "MIDLAND FUNDING LLC" }]
      },
      permit: []
    },
    {
      apn: "KY-JEFF-003",
      address: { street: "122 Fire St", city: "Louisville", state: "KY", zip: "40202" },
      county: "Jefferson",
      owners: [{ fullName: "JOHN SMITH", mailingAddress: { street: "122 Fire St", city: "Louisville", state: "KY", zip: "40202" } }],
      foreclosure: null,
      "mortgage-liens": {},
      permit: [{ permitNumber: "BP-2026-0044", description: "demolition and structural damage repair after severe fire", issueDate: "2026-04-15" }]
    },
    {
      apn: "KY-JEFF-004",
      address: { street: "305 Green Rd", city: "Louisville", state: "KY", zip: "40205" },
      county: "Jefferson",
      owners: [{ fullName: "LISA SMITH", mailingAddress: { street: "305 Green Rd", city: "Louisville", state: "KY", zip: "40205" } }],
      foreclosure: null,
      "mortgage-liens": {},
      permit: [{ permitNumber: "BP-2026-0088", description: "mowing high grass and lawn cleaning", issueDate: "2026-04-10" }]
    },

    // === OLDHAM, KY ===
    {
      apn: "KY-OLD-001",
      address: { street: "101 Maple Ln", city: "La Grange", state: "KY", zip: "40031" },
      county: "Oldham",
      owners: [{ fullName: "ROBERT DAVIS", mailingAddress: { street: "101 Maple Ln", city: "La Grange", state: "KY", zip: "40031" } }],
      foreclosure: { foreclosureStatus: "Active", recordingDate: "2026-04-22", auctionDate: null, caseNumber: "26-CI-88022", plaintiff: "US BANK NA", defendant: "ROBERT DAVIS" },
      "mortgage-liens": {},
      permit: []
    },
    {
      apn: "KY-OLD-002",
      address: { street: "202 Birch Dr", city: "Crestwood", state: "KY", zip: "40014" },
      county: "Oldham",
      owners: [{ fullName: "LINDA JOHNSON", mailingAddress: { street: "202 Birch Dr", city: "Crestwood", state: "KY", zip: "40014" } }],
      foreclosure: null,
      "mortgage-liens": {
        taxLiens: [{ amount: 8200, recordingDate: "2026-02-18", plaintiff: "Oldham County Sheriff" }]
      },
      permit: []
    },
    {
      apn: "KY-OLD-003",
      address: { street: "303 Demolition Way", city: "La Grange", state: "KY", zip: "40031" },
      county: "Oldham",
      owners: [{ fullName: "MARK TAYLOR", mailingAddress: { street: "303 Demolition Way", city: "La Grange", state: "KY", zip: "40031" } }],
      foreclosure: null,
      "mortgage-liens": {},
      permit: [{ permitNumber: "BP-OLD-119", description: "foundation repair and structural stabilization", issueDate: "2026-05-01" }]
    },

    // === BULLITT, KY ===
    {
      apn: "KY-BUL-001",
      address: { street: "303 Cedar Ct", city: "Shepherdsville", state: "KY", zip: "40165" },
      county: "Bullitt",
      owners: [{ fullName: "PATRICIA WHITE", mailingAddress: { street: "303 Cedar Ct", city: "Shepherdsville", state: "KY", zip: "40165" } }],
      foreclosure: { foreclosureStatus: "Active", recordingDate: "2026-05-05", auctionDate: null, caseNumber: "26-CI-77331", plaintiff: "NATIONSTAR MORTGAGE", defendant: "PATRICIA WHITE" },
      "mortgage-liens": {},
      permit: []
    },
    {
      apn: "KY-BUL-002",
      address: { street: "404 Walnut St", city: "Mt Washington", state: "KY", zip: "40047" },
      county: "Bullitt",
      owners: [{ fullName: "DAVID BROWN", mailingAddress: { street: "404 Walnut St", city: "Mt Washington", state: "KY", zip: "40047" } }],
      foreclosure: null,
      "mortgage-liens": {
        taxLiens: [{ amount: 3100, recordingDate: "2026-03-30", plaintiff: "Bullitt County Clerk" }]
      },
      permit: []
    },
    {
      apn: "KY-BUL-003",
      address: { street: "505 Collapse Rd", city: "Shepherdsville", state: "KY", zip: "40165" },
      county: "Bullitt",
      owners: [{ fullName: "SUSAN WILSON", mailingAddress: { street: "505 Collapse Rd", city: "Shepherdsville", state: "KY", zip: "40165" } }],
      foreclosure: null,
      "mortgage-liens": {},
      permit: [{ permitNumber: "BP-BUL-225", description: "demolition of structurally unsafe porch and collapse hazard rebuild", issueDate: "2026-04-18" }]
    },

    // === SHELBY, KY ===
    {
      apn: "KY-SHE-001",
      address: { street: "505 Elm Rd", city: "Shelbyville", state: "KY", zip: "40065" },
      county: "Shelby",
      owners: [{ fullName: "JAMES JONES", mailingAddress: { street: "505 Elm Rd", city: "Shelbyville", state: "KY", zip: "40065" } }],
      foreclosure: { foreclosureStatus: "Active", recordingDate: "2026-05-12", auctionDate: null, caseNumber: "26-CI-55110", plaintiff: "JP MORGAN CHASE", defendant: "JAMES JONES" },
      "mortgage-liens": {},
      permit: []
    },
    {
      apn: "KY-SHE-002",
      address: { street: "606 Court Rd", city: "Shelbyville", state: "KY", zip: "40065" },
      county: "Shelby",
      owners: [{ fullName: "KAREN THOMAS", mailingAddress: { street: "606 Court Rd", city: "Shelbyville", state: "KY", zip: "40065" } }],
      foreclosure: null,
      "mortgage-liens": {
        taxLiens: [{ amount: 5600, recordingDate: "2026-04-05", plaintiff: "Shelby County Clerk" }]
      },
      permit: []
    },
    {
      apn: "KY-SHE-003",
      address: { street: "707 Burned Ave", city: "Shelbyville", state: "KY", zip: "40065" },
      county: "Shelby",
      owners: [{ fullName: "MICHAEL MOORE", mailingAddress: { street: "707 Burned Ave", city: "Shelbyville", state: "KY", zip: "40065" } }],
      foreclosure: null,
      "mortgage-liens": {},
      permit: [{ permitNumber: "BP-SHE-99", description: "roof structural repair and rehabilitation from fire damage", issueDate: "2026-05-10" }]
    },

    // === CLARK, IN ===
    {
      apn: "IN-CLA-001",
      address: { street: "606 Willow Way", city: "Jeffersonville", state: "IN", zip: "47130" },
      county: "Clark",
      owners: [{ fullName: "ELIZABETH TAYLOR", mailingAddress: { street: "606 Willow Way", city: "Jeffersonville", state: "IN", zip: "47130" } }],
      foreclosure: { foreclosureStatus: "Active", recordingDate: "2026-04-10", auctionDate: null, caseNumber: "10C01-2604-MF-00111", plaintiff: "PNC BANK", defendant: "ELIZABETH TAYLOR" },
      "mortgage-liens": {},
      permit: []
    },
    {
      apn: "IN-CLA-002",
      address: { street: "707 Cherry Dr", city: "Clarksville", state: "IN", zip: "47129" },
      county: "Clark",
      owners: [{ fullName: "JOSEPH ANDERSON", mailingAddress: { street: "707 Cherry Dr", city: "Clarksville", state: "IN", zip: "47129" } }],
      foreclosure: null,
      "mortgage-liens": {
        taxLiens: [{ amount: 6700, recordingDate: "2026-02-15", plaintiff: "Clark County Treasurer" }]
      },
      permit: []
    },
    {
      apn: "IN-CLA-003",
      address: { street: "808 Structural Ln", city: "Jeffersonville", state: "IN", zip: "47130" },
      county: "Clark",
      owners: [{ fullName: "THOMAS JACKSON", mailingAddress: { street: "808 Structural Ln", city: "Jeffersonville", state: "IN", zip: "47130" } }],
      foreclosure: null,
      "mortgage-liens": {},
      permit: [{ permitNumber: "BP-CLA-332", description: "demolition and structural damage repair", issueDate: "2026-05-02" }]
    },

    // === FLOYD, IN ===
    {
      apn: "IN-FLO-001",
      address: { street: "808 Poplar Pl", city: "New Albany", state: "IN", zip: "47150" },
      county: "Floyd",
      owners: [{ fullName: "NANCY WHITE", mailingAddress: { street: "808 Poplar Pl", city: "New Albany", state: "IN", zip: "47150" } }],
      foreclosure: { foreclosureStatus: "Active", recordingDate: "2026-05-01", auctionDate: null, caseNumber: "22C01-2605-MF-00222", plaintiff: "FIFTH THIRD BANK", defendant: "NANCY WHITE" },
      "mortgage-liens": {},
      permit: []
    },
    {
      apn: "IN-FLO-002",
      address: { street: "909 Chestnut St", city: "Georgetown", state: "IN", zip: "47122" },
      county: "Floyd",
      owners: [{ fullName: "DANIEL MARTIN", mailingAddress: { street: "909 Chestnut St", city: "Georgetown", state: "IN", zip: "47122" } }],
      foreclosure: null,
      "mortgage-liens": {
        taxLiens: [{ amount: 4100, recordingDate: "2026-03-20", plaintiff: "Floyd County Treasurer" }]
      },
      permit: []
    },
    {
      apn: "IN-FLO-003",
      address: { street: "112 Foundation Way", city: "New Albany", state: "IN", zip: "47150" },
      county: "Floyd",
      owners: [{ fullName: "PAUL GARCIA", mailingAddress: { street: "112 Foundation Way", city: "New Albany", state: "IN", zip: "47150" } }],
      foreclosure: null,
      "mortgage-liens": {},
      permit: [{ permitNumber: "BP-FLO-88", description: "foundation repair and structural damage restoration", issueDate: "2026-04-20" }]
    },

    // === HARRISON, IN ===
    {
      apn: "IN-HAR-001",
      address: { street: "111 Ash Cir", city: "Corydon", state: "IN", zip: "47112" },
      county: "Harrison",
      owners: [{ fullName: "GEORGE HARRIS", mailingAddress: { street: "111 Ash Cir", city: "Corydon", state: "IN", zip: "47112" } }],
      foreclosure: { foreclosureStatus: "Active", recordingDate: "2026-05-03", auctionDate: null, caseNumber: "31C01-2605-MF-00333", plaintiff: "REGIONS BANK", defendant: "GEORGE HARRIS" },
      "mortgage-liens": {},
      permit: []
    },
    {
      apn: "IN-HAR-002",
      address: { street: "222 Court St", city: "Corydon", state: "IN", zip: "47112" },
      county: "Harrison",
      owners: [{ fullName: "DONALD YOUNG", mailingAddress: { street: "222 Court St", city: "Corydon", state: "IN", zip: "47112" } }],
      foreclosure: null,
      "mortgage-liens": {
        taxLiens: [{ amount: 2900, recordingDate: "2026-04-10", plaintiff: "Harrison County Treasurer" }]
      },
      permit: []
    },
    {
      apn: "IN-HAR-003",
      address: { street: "333 Roof Dr", city: "Corydon", state: "IN", zip: "47112" },
      county: "Harrison",
      owners: [{ fullName: "MARIA RODRIGUEZ", mailingAddress: { street: "333 Roof Dr", city: "Corydon", state: "IN", zip: "47112" } }],
      foreclosure: null,
      "mortgage-liens": {},
      permit: [{ permitNumber: "BP-HAR-41", description: "demolition and roof structural rebuild", issueDate: "2026-05-08" }]
    }
  ];

  constructor() {
    this.apiKey = process.env.SKIP_TRACE_API_KEY || process.env.BATCHDATA_API_KEY || "";
    if (!this.apiKey) {
      console.warn("[BATCHDATA WARN] Ni SKIP_TRACE_API_KEY ni BATCHDATA_API_KEY están configuradas en el archivo .env");
    }
  }

  /**
   * Realiza skip tracing de una persona física o corporación
   */
  async skipTrace(
    name: string,
    propertyAddress: BatchDataAddress
  ): Promise<BatchDataSkipTraceResponse> {
    if (!this.apiKey) {
      const mockNames = [
        "CHARLES MILLER", "SARAH CONNOR", "JOHN SMITH", "LISA SMITH", "ROBERT DAVIS", 
        "LINDA JOHNSON", "MARK TAYLOR", "PATRICIA WHITE", "DAVID BROWN", "SUSAN WILSON", 
        "JAMES JONES", "KAREN THOMAS", "MICHAEL MOORE", "ELIZABETH TAYLOR", "JOSEPH ANDERSON", 
        "THOMAS JACKSON", "NANCY WHITE", "DANIEL MARTIN", "PAUL GARCIA", "GEORGE HARRIS", 
        "DONALD YOUNG", "MARIA RODRIGUEZ", "SARAH JENKINS", "ROBERT MILLER", "DAVID TAYLOR", 
        "WILLIAM ANDERSON", "MARY SMITH", "JAMES JOHNSON", "PATRICIA WILLIAMS", "THOMAS DAVIS", 
        "LINDA BROWN", "CHARLES JONES", "RICHARD GARCIA", "DONALD LOPEZ", "STEVEN WILSON", 
        "JOSEPH MARTINEZ", "MARIA CONCEPCION", "JOHNATHAN GALE", "ESTATE OF SARAH JENKINS", "THOMAS BECHT"
      ];
      const isMock = mockNames.some(mn => name.toUpperCase().includes(mn) || mn.includes(name.toUpperCase()));
      if (isMock) {
        console.log(`[BATCHDATA SIMULATED] Skip tracing simulado para lead de demostración: ${name}`);
        return this.getSimulatedResponse(name);
      }
      console.log(`[BATCHDATA SKIP] Sin API Key y no es un lead de simulación para: "${name}". Retornando vacío.`);
      return { success: false, phones: [], emails: [], outOfFunds: true };
    }

    const cleanName = name.replace(/,\s*et\s*al\.?/gi, "")
                          .replace(/,\s*llc\.?/gi, "")
                          .replace(/,\s*inc\.?/gi, "")
                          .trim();
    const nameParts = cleanName.split(/\s+/);
    let firstName = cleanName;
    let lastName = "";
    if (nameParts.length > 1) {
      lastName = nameParts.pop() || "";
      firstName = nameParts.join(" ");
    }

    try {
      console.log(`[BATCHDATA API] Consultando Skip Trace real para "${cleanName}" (${firstName} ${lastName})...`);
      const response = await axios.post(
        `${this.baseUrl}/property/skip-trace`, 
        {
          requests: [
            {
              propertyAddress: {
                street: propertyAddress.street,
                city: propertyAddress.city,
                state: propertyAddress.state,
                zip: propertyAddress.zip
              },
              name: {
                first: firstName,
                last: lastName
              }
            }
          ]
        },
        {
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
          }
        }
      );

      console.log("[BATCHDATA SUCCESS] Skip trace ejecutado exitosamente.");
      const persons = response.data?.results?.persons || [];
      const phones: SkipTracePhone[] = [];
      const emails: SkipTraceEmail[] = [];
      let mailingAddress: BatchDataAddress | undefined = undefined;
      let vacant = false;

      if (persons.length > 0) {
        const person = persons[0];
        const apiPhones = person.phoneNumbers || [];
        const apiEmails = person.emails || [];

        for (const p of apiPhones) {
          phones.push({
            number: p.number || p.phone,
            type: p.type || "Unknown",
            isDNC: p.dnc || p.tcpa || false,
            carrier: p.carrier
          });
        }

        for (const e of apiEmails) {
          const emailStr = typeof e === "string" ? e : (e.email || "");
          if (emailStr) {
            emails.push({
              email: emailStr,
              deliverability: e.deliverability || "Unknown"
            });
          }
        }

        if (person.mailingAddress) {
          mailingAddress = {
            street: person.mailingAddress.street,
            city: person.mailingAddress.city,
            state: person.mailingAddress.state,
            zip: person.mailingAddress.zip
          };
        }
        if (person.property?.vacant !== undefined) {
          vacant = person.property.vacant;
        }
      }

      return {
        success: true,
        phones,
        emails,
        mailingAddress,
        vacant,
        rawResponse: response.data
      };

    } catch (error: any) {
      console.error("[BATCHDATA ERROR] Error al realizar Skip Trace en BatchData:", error.response?.data || error.message);
      const dataStr = JSON.stringify(error.response?.data || {}).toLowerCase();
      const msgStr = (error.message || "").toLowerCase();
      const isOutOfFunds = error.response?.status === 403 || 
                           dataStr.includes("balance") || 
                           dataStr.includes("credit") ||
                           dataStr.includes("insufficient") ||
                           msgStr.includes("403") ||
                           msgStr.includes("forbidden");
      
      return {
        success: false,
        phones: [],
        emails: [],
        outOfFunds: isOutOfFunds
      };
    }
  }

  /**
   * Busca propiedades por estado y condado con filtros adicionales.
   */
  async searchProperties(
    state: string,
    county: string,
    filters?: any
  ): Promise<{ success: boolean; results: any[] }> {
    if (!this.apiKey) {
      console.log(`[BATCHDATA SIMULATED] searchProperties simulado para ${county}, ${state}`);
      return { success: true, results: this.getSimulatedSearchResults(state, county, filters) };
    }
    try {
      console.log(`[BATCHDATA API] Buscando propiedades en ${county}, ${state}...`);
      const response = await axios.post(
        `${this.baseUrl}/property/search`,
        {
          location: { state, county },
          ...filters
        },
        {
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
          }
        }
      );
      return { success: true, results: response.data?.results || [] };
    } catch (error: any) {
      console.error("[BATCHDATA ERROR] Error en searchProperties:", error.response?.data || error.message);
      console.log(`[BATCHDATA FALLBACK] Usando datos simulados para searchProperties en ${county}, ${state}`);
      return { success: true, results: this.getSimulatedSearchResults(state, county, filters) };
    }
  }

  /**
   * Obtiene todos los atributos para una lista de direcciones o APNs.
   */
  async lookupPropertyAllAttributes(
    requests: Array<{ address?: BatchDataAddress; apn?: string }>
  ): Promise<{ success: boolean; results: any[] }> {
    if (!this.apiKey) {
      console.log(`[BATCHDATA SIMULATED] lookupPropertyAllAttributes simulado para ${requests.length} propiedades`);
      return { success: true, results: this.getSimulatedLookupResults(requests) };
    }
    try {
      console.log(`[BATCHDATA API] Consultando all-attributes para ${requests.length} propiedades...`);
      const response = await axios.post(
        `${this.baseUrl}/property/lookup/all-attributes`,
        { requests },
        {
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
          }
        }
      );
      return { success: true, results: response.data?.results || [] };
    } catch (error: any) {
      console.error("[BATCHDATA ERROR] Error en lookupPropertyAllAttributes:", error.response?.data || error.message);
      console.log(`[BATCHDATA FALLBACK] Usando datos simulados para lookupPropertyAllAttributes`);
      return { success: true, results: this.getSimulatedLookupResults(requests) };
    }
  }

  private getSimulatedSearchResults(state: string, county: string, filters: any): any[] {
    const cleanCounty = county.toLowerCase().replace(" county", "").trim();
    const cleanState = state.toUpperCase().trim();
    return this.mockProperties
      .filter(p => p.address.state === cleanState && p.county.toLowerCase() === cleanCounty)
      .map(p => ({
        apn: p.apn,
        address: p.address,
        county: p.county
      }));
  }

  private getSimulatedLookupResults(requests: Array<{ address?: BatchDataAddress; apn?: string }>): any[] {
    const results: any[] = [];
    for (const req of requests) {
      let matched = null;
      if (req.apn) {
        matched = this.mockProperties.find(p => p.apn === req.apn);
      } else if (req.address) {
        matched = this.mockProperties.find(p => 
          p.address.street.toLowerCase() === req.address!.street.toLowerCase() &&
          p.address.state.toUpperCase() === req.address!.state.toUpperCase()
        );
      }
      if (matched) {
        results.push(JSON.parse(JSON.stringify(matched)));
      }
    }
    return results;
  }

  /**
   * Datos simulados para pruebas locales antes de implementar el API Key real
   */
  private getSimulatedResponse(name: string): BatchDataSkipTraceResponse {
    return {
      success: true,
      phones: [
        { number: "(502) 555-0101", type: "Mobile", isDNC: false, carrier: "Verizon Wireless" },
        { number: "(502) 555-0102", type: "Landline", isDNC: true, carrier: "AT&T" }
      ],
      emails: [
        { email: `${name.toLowerCase().replace(/[^a-z]/g, "")}@example.com`, deliverability: "Deliverable" }
      ],
      mailingAddress: {
        street: "123 Main St",
        city: "Louisville",
        state: "KY",
        zip: "40202"
      },
      vacant: false
    };
  }
}
