import axios from "axios";
import { ClassifierResult, ConstructionTradeCategory, ConstructionUrgency } from "../types";
import * as dotenv from "dotenv";

dotenv.config();

const ALLOWED_CATEGORIES: ConstructionTradeCategory[] = [
  "NEW_CONSTRUCTION_GROUND_UP",
  "RENOVATION_REMODEL",
  "ROOFING_SIDING_GUTTERS",
  "FOUNDATION_WATERPROOFING",
  "CONCRETE_ASPHALT_PAVING",
  "FENCE_PERIMETER_SECURITY",
  "DEMOLITION_SITE_PREP",
  "FIRE_WATER_REBUILD",
  "CIVIL_INFRASTRUCTURE_PUBLIC"
];

/**
 * Verifica si el texto corresponde a una oferta de trabajo o auto-promoción de otro contratista.
 */
function isJobOrPromotion(text: string): { isRejected: boolean; reason: string } {
  const lower = text.toLowerCase();

  // 1. Ofertas de Empleo / Mano de Obra
  if (
    lower.includes("looking for subcontractors") ||
    lower.includes("skilled laborers") ||
    lower.includes("now hiring") ||
    lower.includes("hiring for") ||
    lower.includes("se busca ayudante") ||
    lower.includes("se busca carpintero") ||
    lower.includes("se busca cuadrilla") ||
    lower.includes("job opening") ||
    lower.includes("subcontratos abiertos para obras generales") ||
    lower.includes("solicitud de cuadrilla") ||
    lower.includes("knoxville jobs") ||
    lower.includes("nashville jobs") ||
    lower.includes("search group") ||
    lower.includes("employment opportunity")
  ) {
    return { isRejected: true, reason: "Oferta de empleo o reclutamiento de mano de obra." };
  }

  // 2. Promociones de Contratistas / Showcases
  if (
    lower.includes("re-bath") ||
    lower.includes("we re-roofed") ||
    lower.includes("our team completed") ||
    lower.includes("call us today for a free estimate") ||
    lower.includes("llámanos hoy para cotizar") ||
    lower.includes("somos especialistas en") ||
    lower.includes("ofrecemos servicios de") ||
    lower.includes("¿tu techo sufrió daños") ||
    lower.includes("tu techo sufrio") ||
    lower.includes("servicios de remodelacion garantizados") ||
    lower.includes("not all water damage is") ||
    lower.includes("and well, disaster")
  ) {
    return { isRejected: true, reason: "Auto-promoción o anuncio publicitario de otro contratista." };
  }

  // 3. Descarte de servicios no relacionados
  if (
    lower.includes("vehicle") ||
    lower.includes("engine") ||
    lower.includes("oil change") ||
    lower.includes("software") ||
    lower.includes("janitorial")
  ) {
    return { isRejected: true, reason: "Servicio vehicular, mecánico o TI no calificado." };
  }

  return { isRejected: false, reason: "" };
}

/**
 * Clasificador impulsado por Google Gemini Flash para el Módulo de Construcción.
 */
export async function classifyConstructionItem(
  title: string,
  rawDescription: string,
  sourceContext: string
): Promise<ClassifierResult> {
  const fullText = `${title} ${rawDescription} ${sourceContext}`;

  // Filtro previo rápido
  const quickCheck = isJobOrPromotion(fullText);
  if (quickCheck.isRejected) {
    return { isValidConstruction: false, rejectedReason: quickCheck.reason };
  }

  const apiKey = process.env.GEMINI_API_KEY;

  // Fallback heurístico básico si no hay API key
  if (!apiKey) {
    return {
      isValidConstruction: true,
      category: "RENOVATION_REMODEL",
      urgency: "NORMAL",
      summarySpanish: title
    };
  }

  const prompt = `Eres el Auditor Experto de Licitaciones y Obras del Módulo de Construcción de TZEL.
Tu trabajo es evaluar una oportunidad pública o lead de construcción y determinar si es una DEMANDA REAL DE UN CLIENTE o LICITACIÓN OFICIAL.

REGLAS DE CLASIFICACIÓN ESTRICTAS:
1. CATEGORÍAS VÁLIDAS APROBADAS (isValidConstruction = true):
   - Sólo cuando un CLIENTE/PROPIETARIO solicita un trabajo o una ENTIDAD PÚBLICA licita una obra:
   - NEW_CONSTRUCTION_GROUND_UP (Edificación nueva de casas, edificios, naves o anexos)
   - RENOVATION_REMODEL (Remodelaciones de cocinas, baños, oficinas, albañilería, interiores)
   - ROOFING_SIDING_GUTTERS (Techos, tejados, tejas, membranas TPO, canaletas, siding)
   - FOUNDATION_WATERPROOFING (Cimentaciones, grietas en concreto, impermeabilización de sótanos, drenajes)
   - CONCRETE_ASPHALT_PAVING (Pavimentación de calles, banquetas, entradas de autos, concreto estampado)
   - FENCE_PERIMETER_SECURITY (Cercas perimetrales de madera, malla o hierro, portones)
   - DEMOLITION_SITE_PREP (Demoliciones, limpieza y preparación de terrenos para construir)
   - FIRE_WATER_REBUILD (Reconstrucción y restauración de daños por agua, humo o incendio)
   - CIVIL_INFRASTRUCTURE_PUBLIC (Puentes, obras hidráulicas, parques, drenajes públicos)

2. CATEGORÍAS ESTRICTAMENTE RECHAZADAS (isValidConstruction = false):
   - OFERTAS DE TRABAJO / EMPLEO: Reclutamiento de albañiles, carpinteros, subcontratistas asalariados o peones.
   - AUTO-PROMOCIONES DE CONTRATISTAS: Empresas vendiendo sus servicios ("Llámanos para cotizar", "Somos expertos", fotos de trabajos que ya hicieron).
   - MECÁNICA / VEHÍCULOS: Reparación de camiones, patrullas, mantenimiento de flotas, motores.
   - SERVICIOS GENERALES: Limpieza de oficinas (janitorial), software, suministros médicos/papelería.

3. DATOS DE ENTRADA:
   - Título: "${title}"
   - Contexto/Fuente: "${sourceContext}"
   - Descripción completa:
   """${rawDescription.substring(0, 3000)}"""

Por favor responde ÚNICAMENTE en formato JSON con la siguiente estructura:
{
  "isValidConstruction": true o false,
  "rejectedReason": "Explicación si fue rechazada (ej. Es una oferta de trabajo de una agencia)",
  "category": "Una de las 9 categorías válidas aprobadas",
  "estimatedValue": número estimado en USD o 0 si no se menciona,
  "urgency": "NORMAL", "HIGH" o "CRITICAL",
  "summarySpanish": "Resumen ejecutivo claro y conciso de 2 líneas en español explicando exactamente en qué consiste la obra",
  "bondingRequired": true o false (si requiere fianza de licitación / bid bond),
  "deadline": "Fecha límite en formato YYYY-MM-DD o 'Sin especificar'"
}`;

  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const response = await axios.post(
        url,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.1
          }
        },
        { timeout: 10000 }
      );

      const textRes = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textRes) throw new Error("Respuesta vacía de Gemini");

      const parsed: ClassifierResult = JSON.parse(textRes);
      
      if (!ALLOWED_CATEGORIES.includes(parsed.category as ConstructionTradeCategory)) {
        parsed.category = "RENOVATION_REMODEL";
      }

      return parsed;
    } catch (err: any) {
      if (attempts >= 2) {
        console.warn(`[CONSTRUCTION CLASSIFIER ERR] Fallback heurístico: ${err.message}`);
        return {
          isValidConstruction: true,
          category: "RENOVATION_REMODEL",
          urgency: "NORMAL",
          summarySpanish: title
        };
      }
    }
  }

  return {
    isValidConstruction: true,
    category: "RENOVATION_REMODEL",
    urgency: "NORMAL",
    summarySpanish: title
  };
}
