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
}

/**
 * Cliente de Integración de BatchData API
 */
export class BatchDataClient {
  private apiKey: string;
  private baseUrl = "https://api.batchdata.com/api/v1";

  constructor() {
    this.apiKey = process.env.SKIP_TRACE_API_KEY || process.env.BATCHDATA_API_KEY || "";
    if (!this.apiKey) {
      console.warn("[BATCHDATA WARN] Ni SKIP_TRACE_API_KEY ni BATCHDATA_API_KEY están configuradas en el archivo .env");
    }
  }

  /**
   * Realiza skip tracing de una persona física o corporación
   * @param name Nombre del demandado / propietario
   * @param propertyAddress Dirección del inmueble ejecutado
   */
  async skipTrace(
    name: string,
    propertyAddress: BatchDataAddress
  ): Promise<BatchDataSkipTraceResponse> {
    if (!this.apiKey) {
      console.log(`[BATCHDATA SIMULATED] Skip tracing simulado para: ${name}`);
      return this.getSimulatedResponse(name);
    }

    // Dividir el nombre en nombre de pila y apellido para el esquema de BatchData
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
      return {
        success: false,
        phones: [],
        emails: []
      };
    }
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
