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

  // 1. Ofertas de Empleo / Mano de Obra / Jornaleros buscando trabajo
  if (
    lower.includes("busco trabajo") ||
    lower.includes("buscando trabajo") ||
    lower.includes("estoy buscando trabajo") ||
    lower.includes("busco empleo") ||
    lower.includes("buscando empleo") ||
    lower.includes("looking for work") ||
    lower.includes("need a job") ||
    lower.includes("looking for a job") ||
    lower.includes("tengo herramientas") ||
    lower.includes("tengo herramienta y troca") ||
    lower.includes("have tools and truck") ||
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
    return { isRejected: true, reason: "Oferta de empleo, jornalero buscando trabajo o reclutamiento de mano de obra." };
  }

  // 2. Promociones de Contratistas / Showcases / Anuncios
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
    lower.includes("and well, disaster") ||
    lower.includes("built strong. built right") ||
    lower.includes("ready to enjoy call") ||
    lower.includes("free estimates call") ||
    lower.includes("estimados gratis al")
  ) {
    return { isRejected: true, reason: "Auto-promoción o anuncio publicitario de otro contratista." };
  }

  // 3. Descarte de servicios no relacionados
  if (
    lower.includes("vehicle") ||
    lower.includes("engine") ||
    lower.includes("oil change") ||
    lower.includes("software") ||
    lower.includes("janitorial") ||
    lower.includes("plomero") ||
    lower.includes("plomería") ||
    lower.includes("plumbing") ||
    lower.includes("electricista") ||
    lower.includes("electrician")
  ) {
    return { isRejected: true, reason: "Servicio no calificado, vehicular, plomería o electricidad pura fuera de alcance." };
  }

  return { isRejected: false, reason: "" };
}

/**
 * Clasificador impulsado por Google Gemini 3.8 Flash para el Módulo de Construcción (Barba Construction).
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

  if (!apiKey) {
    return {
      isValidConstruction: false,
      rejectedReason: "GEMINI_API_KEY no configurada. Descartado por seguridad."
    };
  }

  const prompt = `Eres el Auditor Táctico de Obras y Leads de Barba Construction en Kentucky (Louisville / Jefferson County) e Indiana.
Tu misión es evaluar publicaciones o licitaciones y determinar ÚNICAMENTE si corresponden a un CLIENTE, PROPIETARIO O INVERSIONISTA REAL que busca contratar obras o reformas para su propiedad.

REGLAS DE EVALUACIÓN ESTRICTAS:
1. LEAD VÁLIDO (isValidConstruction = true):
   - Un dueño de casa, negocio o inversionista solicitando activamente cotizaciones, recomendaciones o reportando daños urgentes en su propiedad.
   - Categorías aprobadas:
     * NEW_CONSTRUCTION_GROUND_UP (Edificación nueva, adiciones de cuartos, garages)
     * RENOVATION_REMODEL (Remodelación cocina, baño, sótanos, drywall, pisos, pintura)
     * ROOFING_SIDING_GUTTERS (Reparación/cambio de techos, tejas, goteras, canaletas, siding)
     * FOUNDATION_WATERPROOFING (Cimentación, grietas en concreto, impermeabilización sótano)
     * CONCRETE_ASPHALT_PAVING (Driveways, losas, patios de concreto, aceras)
     * FENCE_PERIMETER_SECURITY (Cercas de madera, vinilo, portones)
     * DEMOLITION_SITE_PREP (Demolición, preparación de lote)
     * FIRE_WATER_REBUILD (Restauración tras tormenta, incendio, ramas caídas)
     * CIVIL_INFRASTRUCTURE_PUBLIC (Licitaciones públicas oficiales de obra civil)

2. RECHAZAR OBLIGATORIAMENTE (isValidConstruction = false):
   - Personas buscando empleo ("busco trabajo", "cuadrilla disponible", "tengo troca").
   - Contratistas o empresas promocionándose ("ofrecemos", "llámanos", "fotos de nuestros trabajos", "free estimate").
   - Ofertas de empleo o staffing ("se busca ayudante", "now hiring").
   - Plomería o electricidad pura (salvo que sea parte de una remodelación integral).
   - Venta de autos, alquiler de cuartos, muebles o servicios no relacionados.

3. DATOS DE ENTRADA:
   - Título: "${title}"
   - Fuente/Contexto: "${sourceContext}"
   - Texto del lead:
   """${rawDescription.substring(0, 2500)}"""

Responde ÚNICAMENTE en formato JSON estricto con los siguientes campos:
{
  "isValidConstruction": true o false,
  "rejectedReason": "Motivo conciso si fue rechazado (ej. Jornalero buscando trabajo / Anuncio de contratista)",
  "category": "Una de las 9 categorías válidas aprobadas",
  "estimatedValue": número estimado en USD o 0,
  "urgency": "NORMAL", "HIGH" o "CRITICAL",
  "summarySpanish": "Resumen ejecutivo en español de 2 líneas describiendo exactamente el trabajo solicitado",
  "bondingRequired": false,
  "deadline": "Fecha límite o 'Sin especificar'",
  "suggestedResponse": "Respuesta profesional en inglés de 2 a 3 líneas lista para que Barba Construction comente o contacte por DM al cliente, destacando seguro, licencia en KY/IN y ofreciendo estimado sin costo."
}`;

  const models = [process.env.GEMINI_MODEL || "gemini-3.8-flash", "gemini-3.1-flash-lite"];

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await axios.post(
        url,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.1
          }
        },
        { timeout: 8000 }
      );

      const textRes = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textRes) continue;

      const parsed: ClassifierResult = JSON.parse(textRes);

      if (!ALLOWED_CATEGORIES.includes(parsed.category as ConstructionTradeCategory)) {
        parsed.category = "RENOVATION_REMODEL";
      }

      return parsed;
    } catch (err: any) {
      console.warn(`[CONSTRUCTION CLASSIFIER] Error con ${model}: ${err.message}`);
    }
  }

  // Fallback seguro: si la IA falló, NO permitir que basura entre a la base de datos
  return {
    isValidConstruction: false,
    rejectedReason: "Fallo temporal de API en clasificación por IA (rechazado por precaución)"
  };
}
