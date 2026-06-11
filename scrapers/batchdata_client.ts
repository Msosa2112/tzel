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
 * Listo para ser activado la próxima semana.
 */
export class BatchDataClient {
  private apiKey: string;
  private baseUrl = "https://api.batchdata.com/api/v1"; // Confirmar endpoint oficial en documentación

  constructor() {
    this.apiKey = process.env.BATCHDATA_API_KEY || "";
    if (!this.apiKey) {
      console.warn("[BATCHDATA WARN] BATCHDATA_API_KEY no está configurada en el archivo .env");
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

    try {
      // Endpoint oficial de BatchData skip-trace
      const response = await axios.post(
        `${this.baseUrl}/skip-trace`, 
        {
          persons: [
            {
              name: name,
              address: {
                street: propertyAddress.street,
                city: propertyAddress.city,
                state: propertyAddress.state,
                zip: propertyAddress.zip
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

      // La próxima semana mapearemos la respuesta JSON real de la API de BatchData aquí.
      console.log("[BATCHDATA SUCCESS] Skip trace ejecutado exitosamente.");
      return {
        success: true,
        phones: [], // Mapear teléfonos reales
        emails: [], // Mapear correos reales
        rawResponse: response.data
      };

    } catch (error: any) {
      console.error("[BATCHDATA ERROR] Error al realizar Skip Trace en BatchData:", error.message);
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
