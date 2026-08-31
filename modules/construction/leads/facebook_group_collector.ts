import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import axios from "axios";
import { ConstructionLead, ClassifierResult, ConstructionTradeCategory } from "../types";
import { saveConstructionLead } from "../db_construction";
import * as dotenv from "dotenv";

dotenv.config();

// ============================================================================
// PILAR 4: DICCIONARIO DE PALABRAS NEGATIVAS (FILTRO ANTI-SPAM + EXCLUSIÓN DE FONTANERÍA Y ELECTRICIDAD)
// ============================================================================
const NEGATIVE_KEYWORDS_SPANISH = [
  // 1. EXCLUSIÓN EXPLÍCITA: PLOMERÍA Y ELECTRICIDAD (NO FORMAN PARTE DEL SCOPE)
  "plomero", "plomeria", "plomería", "fontanero", "fontaneria", "fontanería", "calentador de agua", "water heater",
  "destapar cañeria", "destapar cañería", "destapar drenaje", "fuga de agua en tubo", "tuberia rota", "tubería rota",
  "electricista", "electricidad", "cableado electrico", "cableado eléctrico", "panel electrico", "panel eléctrico",
  "breikera", "cortocircuito", "tomacorriente", "instalacion electrica", "instalación eléctrica",
  
  // 2. Autopromoción de contratistas / spam
  "ofrecemos", "llámanos al", "llamanos al", "llamar al", "llame al", "presupuestos sin compromiso",
  "nuestros servicios", "a sus órdenes", "a sus ordenes", "somos una compañía", "somos una empresa",
  "hacemos todo tipo de trabajo", "trabajo garantizado", "trabajos garantizados", "cotizaciones gratis al", "escribeme al privado",
  "escríbeme al privado", "dm para precios", "se solicita", "se busca chofer", "se busca mesero",
  "renta de cuarto", "renta de habitacion", "venta de auto", "limpieza de casas", "viajes a",
  "envios a cuba", "envíos a", "compro carros", "seguros de vida", "estimado gratis", "estimados gratis",
  "free estimate", "free estimates", "estimado sin costo", "trabajos de concreto", "trabajos de techos",
  "trabajos de pintura", "trabajos de siding", "hacemos cercas", "hacemos concreto", "hacemos techos",
  "ofrezco mis servicios", "ofrezco servicios", "a la orden para estimados", "a la orden para cualquier trabajo",
  
  // 3. Oficios ajenos a la obra
  "estilista", "peluquería", "peluqueria", "barbero", "manicurista", "uñas", "tatuaje", "tatoo",
  "dentista", "abogado", "veterinario", "mecánico", "mecanico", "maquillaje", "torta", "pastel",
  "niñera", "babysitter", "celular", "iphone"
];

const NEGATIVE_KEYWORDS_ENGLISH = [
  // 1. EXPLICIT EXCLUSION: PLUMBING & ELECTRICAL (OUT OF SCOPE)
  "plumber", "plumbing", "water heater repair", "clogged drain", "unclog pipe", "sewer line replacement",
  "burst pipe", "hydro jetting", "electrician", "electrical wiring", "breaker panel", "rewiring",
  "circuit breaker", "electrician needed", "install outlet", "lighting wiring", "generator installation",
  
  // 2. Contractor advertising / spam
  "we offer", "call us at", "call us for", "call or text", "our services", "fully insured",
  "licensed and insured", "contact us today", "free estimates call", "give us a call",
  "dm for rates", "dm for quote", "now hiring", "route for sale", "delivery driver",
  "moving service", "cleaners needed", "cars for sale", "apartment for rent", "room for rent",
  "happy homeowner", "for a limited time", "special discount", "offering 20% off", "my name is", "i am a local contractor",
  
  // 3. Unrelated trades
  "hair stylist", "haircut", "barber", "nail tech", "dentist", "lawyer", "mechanic", "auto repair",
  "tattoo", "makeup", "babysitter", "nanny", "catering", "baker", "car wash"
];

// ============================================================================
// TODAS LAS LÍNEAS DE CONSTRUCCIÓN DE EE.UU. (EXCEPTO PLOMERÍA Y ELECTRICIDAD)
// ============================================================================
const CONSTRUCTION_TOPICS = [
  // 1. Techos / Roofing
  "roof", "roofer", "roofing", "shingle", "shingles", "metal roof", "flat roof", "rubber roof", "tpo",
  "techo", "techador", "techos", "tejas", "cubierta", "gotera", "goteras", "arreglo de techo",
  
  // 2. Canaletas / Gutters & Siding
  "gutter", "gutters", "downspout", "downspouts", "gutter guard", "gutter guards", "seamless gutters",
  "fascia", "fascia board", "soffit", "siding", "vinyl siding", "hardie board", "metal siding",
  "canaleta", "canaletas", "bajante", "bajantes", "desague", "desagüe", "limpieza de canaletas",
  
  // 3. Extensiones & Ampliaciones
  "addition", "home addition", "room addition", "sunroom", "extension", "expand house", "build a room",
  "in-law suite", "garage addition", "detached garage", "ampliacion", "ampliación", "extender techo",
  "hacer una extension", "hacer una extensión", "ampliar casa", "hacer un cuarto",
  
  // 4. Porches, Patios & Terrazas
  "porch", "front porch", "back porch", "screened porch", "covered porch", "patio cover", "deck", "decks",
  "wood deck", "composite deck", "trex", "pergola", "gazebo", "balcony", "porche", "porches", "terraza",
  "terrazas", "pergola", "pérgola", "enramada", "hacer un deck", "construir porche",
  
  // 5. Remodelaciones & Reformas (Cocinas, Sótanos, Interiores)
  "remodel", "remodeling", "renovation", "kitchen remodel", "basement finish", "finished basement",
  "drywall", "sheetrock", "pladur", "tablaroca", "framing", "carpenter", "carpentry", "cabinets",
  "kitchen cabinets", "flooring", "hardwood", "lvp", "tile floor", "painting", "painter", "house paint",
  "remodelacion", "remodelación", "remodelar cocina", "gabinetes", "pintura", "pintor", "carpintero",
  "carpinteria", "carpintería", "poner piso", "arreglar drywall", "terminar sotano", "terminar sótano",
  
  // 6. Baños / Bathrooms
  "bathroom remodel", "bath remodel", "walk-in shower", "tile shower", "bathtub replacement", "vanity install",
  "shower remodel", "remodelar baño", "remodelacion de baño", "enchape de baño", "azulejos", "cambiar tina",
  
  // 7. Cercas & Portones / Fencing
  "fence", "fencing", "privacy fence", "wood fence", "vinyl fence", "chain link", "aluminum fence", "gate",
  "cerca", "cercas", "cerca de madera", "cerca de vinilo", "porton", "portón", "verja", "malla", "instalar cerca",
  
  // 8. Concreto, Pavimentación & Albañilería / Concrete & Masonry
  "concrete", "cement", "driveway", "patio", "sidewalk", "slab", "stamped concrete", "asphalt", "paving",
  "masonry", "brick", "retaining wall", "foundation", "crawl space", "waterproofing", "concreto", "cemento",
  "entrada de carro", "vaciado de concreto", "losas", "acera", "muro de contencion", "muro de contención",
  "fundacion", "fundación", "sotano", "sótano", "albanil", "albañil",
  
  // 9. Obra Nueva & Daños / Ground-up & Storm Damage
  "new construction", "custom home", "general contractor", "contractor", "handyman", "builder",
  "tree fell", "storm damage", "wind damage", "hail damage", "water damage", "arbol cayo", "árbol cayó",
  "daño de tormenta", "daño por viento", "obra nueva", "construccion", "construcción"
];

// ============================================================================
// PILARES 1, 2 Y 3: PATRONES DE INTENCIÓN REAL Y REPORTES DE PROBLEMAS
// ============================================================================
const INTENT_PATTERNS_ENGLISH = [
  // 1. Lenguaje Conversacional y Búsqueda de Referencias
  /\biso\b/i, /in search of/i, /recommendations? (for|on)/i, /anyone know a good/i,
  /who do you (use|recommend) for/i, /need quotes? for/i, /looking for a (good|reliable|licensed|affordable)/i,
  /who can fix/i, /who can build/i, /who can install/i, /who can replace/i, /who does/i, /need contractor for/i,
  
  // 2. Reporte Temprano de Daños
  /roof leak/i, /water damage/i, /tree fell/i, /wind damage/i, /shingles? blew off/i,
  /flooded basement/i, /crack in (foundation|wall|driveway)/i, /water in crawl space/i,
  
  // 3. Todas las Líneas de Obra Específicas
  /gutter (installation|repair|cleaning|replacement|guards?)/i, /clean (out )?gutters/i, /downspouts?/i, /fascia board/i, /soffit/i,
  /siding (repair|replacement|install)/i, /replace siding/i,
  /deck (builder|building|repair|staining)/i, /build (a )?deck/i, /porch (builder|rebuild|addition|remodel)/i, /screened porch/i,
  /home addition/i, /room addition/i, /sunroom/i, /detached garage/i, /expand (my )?house/i,
  /kitchen (remodel|makeover|cabinets|renovation)/i, /bathroom (remodel|renovation|tile|shower)/i, /walk-in shower/i,
  /finish(ed)? basement/i, /drywall (repair|finishing|hanging)/i, /floor installation/i, /tile installation/i,
  /fence (installation|repair|builder)/i, /privacy fence/i,
  /concrete (driveway|patio|slab|pour|walkway)/i, /retaining wall/i, /foundation repair/i
];

const INTENT_PATTERNS_SPANISH = [
  // 1. Lenguaje Conversacional Explícito de COMPRADOR / CONTRATACIÓN
  /alguien me recomienda/i,
  /alguien conoce a un buen/i,
  /quién me hace un estimado/i,
  /quien me hace un estimado/i,
  /referencias de contratista/i,
  /referencias de roofero/i,
  /quien me cotiza/i,
  /quién me cotiza/i,
  /alguien que sepa de/i,
  /busco quien/i,
  /busco a alguien que/i,
  /busco contratista/i,
  /busco roofero/i,
  /busco albañil/i,
  /busco carpintero/i,
  /necesito quien/i,
  /necesito a alguien que/i,
  /necesito que me hagan/i,
  /necesito que me instalen/i,
  /necesito que me reparen/i,
  /alguien que haga/i,
  /alguien que repare/i,
  /busco presupuesto/i,
  /cuanto cobran por/i,
  /cuánto cobran por/i,
  /necesito presupuesto para/i,
  /alguien que construya/i,
  /alguien que instale/i,
  
  // 2. Intención Temprana / Daños Físicos en la Vivienda
  /tengo una gotera/i,
  /tengo goteras/i,
  /se me meti[oó] el agua/i,
  /se me est[aá] metiendo el agua/i,
  /reparar da[nñ]o de tormenta/i,
  /arbol cay[oó] en (el )?techo/i,
  /humedad en el s[oó]tano/i,
  /filtraci[oó]n de agua/i,
  /se me rompi[oó] la cerca/i,
  /se me cay[oó] la cerca/i,
  /el techo se est[aá] cayendo/i,
  /se volaron las tejas/i,
  /techo goteando/i
];

/**
 * Filtro Heurístico basado en los 5 Pilares de Construcción (Sin Plomería ni Electricidad)
 */
export function evaluateIntentWithPillars(postText: string, author: string): ClassifierResult {
  const lower = postText.toLowerCase();

  // 1. Descarte estricto por palabras negativas y oficios ajenos (Incluye Plomería y Electricidad)
  for (const neg of NEGATIVE_KEYWORDS_SPANISH) {
    if (lower.includes(neg)) {
      return { isValidConstruction: false, rejectedReason: `Exclusión: Plomería/Electricidad/Spam ("${neg}")` };
    }
  }
  for (const neg of NEGATIVE_KEYWORDS_ENGLISH) {
    if (lower.includes(neg)) {
      return { isValidConstruction: false, rejectedReason: `Exclusion: Plumbing/Electrical/Spam ("${neg}")` };
    }
  }

  // 1.1 Descarte automático si el autor es un perfil de negocio o contratista
  const lowerAuthor = (author || "").toLowerCase();
  const BUSINESS_AUTHOR_PATTERNS = [
    "roofing", "construction", "siding", "gutters", "handyman", "concrete", "contractor",
    "remodeling", "remodelaciones", "carpinteria", "carpintería", "services", "company",
    "llc", "corp", "builders", "stone house", "clean pro", "escuelita", "pintor", "albañil"
  ];
  if (BUSINESS_AUTHOR_PATTERNS.some(pat => lowerAuthor.includes(pat))) {
    return { isValidConstruction: false, rejectedReason: `Perfil de negocio / contratista detectado: "${author}"` };
  }

  // 1.2 Descarte automático por frases evidentes de vendedor, recomendación de terceros, búsqueda de empleo o staffing
  const SELLER_PHRASES = [
    "se hacen", "hacemos", "ofrecemos", "ofrezco", "llámanos", "llamanos", "llamar al", "llame al", "llamarme",
    "no duden en", "no dude en", "estimado gratis", "estimados gratis", "free estimate", "free estimates",
    "trabajo garantizado", "trabajos garantizados", "fotos de nuestros", "a la orden para", "a sus órdenes",
    "a sus ordenes", "cotizaciones gratis", "somos una", "say hello to your dream home", "for rent", "se renta",
    "looking for a new fresh look", "that's where we come in", "send message, comment, text",
    "lo recomiendo", "los recomiendo", "super recomendado", "recomiendo a", "hace trabajos de", "trabaja muy rapido",
    "en la tarjeta", "su tarjeta", "mi tarjeta", "visita su pagina", "contactalo", "contáctalo", "llámalo", "llamalo",
    "busco trabajo", "buscando trabajo", "busca trabajo", "busco empleo", "buscando empleo", "trabajo en la construccion",
    "trabajo en construccion", "en busca de trabajo", "disponible para trabajar", "experiencia en construccion",
    "de limpieza", "ayuda por parte del personal", "ayudante de", "ayudante de camion", "ayudante de cocina",
    "ocupo ayudante", "necesito ayudante", "persona para trabajar", "si te interesa enviame", "ganas de salir adelante",
    "autorización para trabajar", "autorizacion para trabajar", "mi número es +1", "mi numero es +1",
    "staffing", "stafin", "oportunidades de trabajo", "aplicaste todavía", "aplicaste todavia", "aqui te traigo oportunidades",
    "aquí te traigo oportunidades", "agencia de empleo", "reclutamiento", "contratando personal",
    "built strong. built right", "call, text, or contact us", "ready to enjoy call", "thinking about adding a deck",
    "whether it's for relaxing", "whether it’s for relaxing", "we’ve got you covered", "we've got you covered",
    "one call. endless possibilities", "if it’s on your to-do list, it’s on ours", "if it's on your to-do list",
    "tu casa o negocio necesita una remodelación", "tu casa o negocio necesita una remodelacion",
    "¿buscas un contratista de concreto de confianza?", "buscas un contratista de concreto",
    "deck looking worn out? we can help", "deck looking worn out", "waterproofed basement backed",
    "restored/waterproofed basement"
  ];
  for (const phrase of SELLER_PHRASES) {
    if (lower.includes(phrase)) {
      return { isValidConstruction: false, rejectedReason: `Autopromoción, recomendación ajena, staffing o búsqueda de empleo ("${phrase}")` };
    }
  }

  // 2. Comprobación obligatoria de pertenecer al rubro de construcción física / remodelación
  const hasConstructionTopic = CONSTRUCTION_TOPICS.some(topic => lower.includes(topic));
  if (!hasConstructionTopic) {
    return { isValidConstruction: false, rejectedReason: "No pertenece a construcción o remodelación de inmuebles" };
  }

  // 3. Verificación de intención conversacional o pase directo a IA
  const matchesEnglish = INTENT_PATTERNS_ENGLISH.some(regex => regex.test(postText));
  const matchesSpanish = INTENT_PATTERNS_SPANISH.some(regex => regex.test(postText));
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);

  // Si no tiene intención explícita y tampoco hay clave de Gemini para analizar semántica, rechazar
  if (!matchesEnglish && !matchesSpanish && !hasGeminiKey) {
    return { isValidConstruction: false, rejectedReason: "No contiene intención conversacional evidente y no hay IA disponible" };
  }

  // 4. Clasificación precisa de Oficio y Valor Estimado
  let category: ConstructionTradeCategory = "RENOVATION_REMODEL";
  let estimated = 6500;
  let summary = `Cliente (${author}) solicita presupuesto o recomendación para obras / remodelación.`;

  if (/gotera|roof|shingle|techo|tejas|cubierta/i.test(postText)) {
    category = "ROOFING_SIDING_GUTTERS";
    estimated = 13500;
    summary = `🏠 TECHOS: Cliente (${author}) reporta gotera, daño en tejado o solicita cambio/reparación de cubierta.`;
  } else if (/canaleta|gutter|downspout|bajante|fascia|soffit|gutter guard/i.test(postText)) {
    category = "ROOFING_SIDING_GUTTERS";
    estimated = 3500;
    summary = `🌊 CANALETAS & BAJANTES: Cliente (${author}) solicita instalación, cambio o reparación de canaletas/fascia.`;
  } else if (/siding|hardie board|vinyl siding|revestimiento/i.test(postText)) {
    category = "ROOFING_SIDING_GUTTERS";
    estimated = 8500;
    summary = `🛡️ SIDING & REVESTIMIENTO: Cliente (${author}) busca contratista para instalación o reparación de siding.`;
  } else if (/ampliaci|extensi|addition|sunroom|expand|extender techo|hacer un cuarto|garage build|detached garage/i.test(postText)) {
    category = "NEW_CONSTRUCTION_GROUND_UP";
    estimated = 28000;
    summary = `🏗️ EXTENSIÓN / AMPLIACIÓN: Cliente (${author}) planea ampliación de vivienda, cuarto adicional o garaje.`;
  } else if (/porche|porch|deck|terraza|p[eé]rgola|patio cover|balc[oó]n|enramada/i.test(postText)) {
    category = "RENOVATION_REMODEL";
    estimated = 8500;
    summary = `🪵 PORCHES, DECKS & PATIOS: Cliente (${author}) busca constructor para porche, terraza de madera o pérgola.`;
  } else if (/ba[nñ]o|bathroom|shower|ducha|tina|bathtub|tile shower|enchape/i.test(postText)) {
    category = "RENOVATION_REMODEL";
    estimated = 9500;
    summary = `🚿 REMODELACIÓN DE BAÑOS & AZULEJOS: Cliente (${author}) solicita remodelación de baño, ducha o cambio de tina.`;
  } else if (/cocina|kitchen|cabinet|gabinete|countertop|isla/i.test(postText)) {
    category = "RENOVATION_REMODEL";
    estimated = 14000;
    summary = `🍳 REMODELACIÓN DE COCINA: Cliente (${author}) busca carpintería, gabinetes o remodelación completa de cocina.`;
  } else if (/cerca|fence|port[oó]n|verja|malla|privacy fence/i.test(postText)) {
    category = "FENCE_PERIMETER_SECURITY";
    estimated = 4800;
    summary = `🛡️ CERCAS & PORTONES: Cliente (${author}) solicita instalación o reparación de cerca de madera/vinilo/aluminio.`;
  } else if (/concreto|cemento|driveway|entrada|patio|sidewalk|acera|slab|losa|retaining wall/i.test(postText)) {
    category = "CONCRETE_ASPHALT_PAVING";
    estimated = 7500;
    summary = `🏗️ CONCRETO & ALBAÑILERÍA: Cliente (${author}) requiere vaciado de losa, driveway, patio o muro de contención.`;
  } else if (/drywall|tablaroca|pladur|sheetrock|pintura|pintar|paint|piso|floor|hardwood|lvp/i.test(postText)) {
    category = "RENOVATION_REMODEL";
    estimated = 5500;
    summary = `🎨 ACABADOS INTERIORES: Cliente (${author}) busca especialista en drywall, pintura, pisos o sótano.`;
  } else if (/fundaci[oó]n|foundation|s[oó]tano|basement|waterproof|filtraci[oó]n|crawl space/i.test(postText)) {
    category = "FOUNDATION_WATERPROOFING";
    estimated = 11000;
    summary = `💧 CIMENTACIÓN / SÓTANO: Cliente (${author}) reporta entrada de agua, grietas o requiere impermeabilización.`;
  } else if (/tree fell|[aá]rbol cay[oó]|da[nñ]o de tormenta|storm damage|water damage/i.test(postText)) {
    category = "FIRE_WATER_REBUILD";
    estimated = 16000;
    summary = `🌪️ DAÑO DE TORMENTA / IMPACTO: Cliente (${author}) reporta caída de árbol, viento o daños estructurales.`;
  }

  return {
    isValidConstruction: true,
    category,
    urgency: "HIGH",
    estimatedValue: estimated,
    summarySpanish: summary
  };
}

/**
 * Clasificador con Gemini 1.5 Flash auditado con las reglas de todos los oficios de obra (Excluyendo Plomería y Electricidad)
 */
async function classifyFacebookLead(postText: string, author: string, postUrl: string): Promise<ClassifierResult> {
  const initialCheck = evaluateIntentWithPillars(postText, author);
  if (!initialCheck.isValidConstruction) return initialCheck;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return initialCheck;

  const prompt = `Eres el Auditor de Leads de Facebook de TZEL para Construcción, Obras y Reformas en Louisville, KY y Sur de Indiana.

REGLAS DE CLASIFICACIÓN:
1. LEAD VÁLIDO: Propietario o cliente buscando cotizaciones, recomendaciones de contratistas o reportando daños físicos en su propiedad para:
   - Techos (Roofing), Goteras, Tejas.
   - Canaletas (Gutters), Bajantes, Fascia, Soffit.
   - Siding (Revestimiento de vinilo, madera, Hardie).
   - Extensiones y Ampliaciones de casas (Home Additions, Sunrooms, Garajes).
   - Porches, Terrazas, Patios cubiertos, Pérgolas, Decks de madera/compuesto.
   - Remodelaciones generales (Cocinas, Sótanos, Drywall, Pintura, Pisos).
   - Remodelación de Baños, Duchas modernas, Azulejos, Tinás.
   - Cercas perimetrales (Fences de madera, vinilo, aluminio).
   - Concreto, Pavimentación, Driveways, Losas, Muros de contención.
   - Obra nueva y reparaciones por tormentas/árboles caídos.

2. RECHAZAR OBLIGATORIAMENTE:
   - Trabajos de Plomería pura (calentadores de agua, tuberías tapadas, fontanería).
   - Trabajos de Electricidad pura (cableado, paneles eléctricos, enchufes).
   - Autopromoción de contratistas que venden sus propios servicios ("ofrecemos", "call us", "llámanos", fotos de trabajos terminados).
   - Venta de productos, autos o empleos ajenos.

Post de "${author}":
"""${postText.substring(0, 1500)}"""

Responde ÚNICAMENTE en JSON:
{
  "isValidConstruction": true o false,
  "rejectedReason": "Motivo si fue rechazada",
  "category": "Una de las 8 categorías aprobadas de obra",
  "estimatedValue": número aproximado en USD,
  "urgency": "HIGH",
  "summarySpanish": "Resumen claro en español de 2 líneas describiendo exactamente el trabajo o daño físico que requiere el cliente"
}`;

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json", temperature: 0.1 }
      },
      { timeout: 9000 }
    );
    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return JSON.parse(text) as ClassifierResult;
  } catch {}

  return initialCheck;
}

/**
 * MATRIZ DE BÚSQUEDA EXHAUSTIVA DE TODAS LAS LÍNEAS DE CONSTRUCCIÓN (LOUISVILLE, KY & SUR DE INDIANA)
 * (Techos, Canaletas, Siding, Extensiones, Porches, Decks, Remodelación, Baños, Cercas, Concreto, Obra Nueva)
 */
const ALL_TRADES_CONSTRUCTION_QUERIES = [
  // =============================================================
  // 1. CANALETAS, BAJANTES & SIDING (GUTTERS & SIDING)
  // =============================================================
  "Louisville gutter installation",
  "Louisville gutter repair",
  "Louisville clean gutters",
  "Louisville downspout repair",
  "Louisville siding repair",
  "Louisville siding replacement",
  "Clarksville IN gutter repair",
  "New Albany IN gutter installation",
  "Clarksville IN siding repair",
  "New Albany IN siding contractor",
  "Louisville quien pone canaletas",
  "Louisville cambio de canaletas",
  "Louisville arreglar canaletas",
  "Louisville poner siding",
  
  // =============================================================
  // 2. EXTENSIONES, AMPLIACIONES & GARAJES (ADDITIONS & EXTENSIONS)
  // =============================================================
  "Louisville home addition contractor",
  "Louisville room addition",
  "Louisville sunroom builder",
  "Louisville garage builder",
  "Clarksville IN home addition",
  "New Albany IN room addition",
  "Louisville ampliar casa",
  "Louisville extender techo",
  "Louisville hacer un cuarto",
  "Louisville hacer un garaje",
  
  // =============================================================
  // 3. PORCHES, PATIOS, PÉRGOLAS & DECKS
  // =============================================================
  "Louisville deck porch builder",
  "Louisville build a deck",
  "Louisville deck repair",
  "Louisville screened porch builder",
  "Louisville covered patio builder",
  "Clarksville IN deck builder",
  "New Albany IN porch builder",
  "Louisville construir porche",
  "Louisville hacer un deck",
  "Louisville pergola patio",
  "Louisville techo para patio",
  
  // =============================================================
  // 4. TECHOS, GOTERAS & DAÑOS DE TORMENTA (ROOFING & STORM REPAIR)
  // =============================================================
  "Louisville ISO roofer",
  "Louisville roof replacement",
  "Louisville roof leak",
  "Louisville shingles blew off",
  "Louisville tree fell roof",
  "Louisville water damage repair",
  "Clarksville IN ISO roofer",
  "New Albany IN roof leak",
  "Southern Indiana ISO roofer",
  "Louisville tengo una gotera",
  "Louisville reparar daño de tormenta",
  "Louisville arreglo de techo",
  "Louisville cambio de techo",
  
  // =============================================================
  // 5. REMODELACIONES, COCINAS, BAÑOS & SÓTANOS (REMODELING & BATHS)
  // =============================================================
  "Louisville bathroom remodel",
  "Louisville walk in shower tile",
  "Louisville kitchen remodel contractor",
  "Louisville kitchen cabinets floor",
  "Louisville finished basement contractor",
  "Louisville drywall contractor",
  "Louisville interior painting contractor",
  "Clarksville IN bathroom remodel",
  "New Albany IN kitchen remodel",
  "Louisville remodelar baño",
  "Louisville remodelar cocina",
  "Louisville instalar gabinetes",
  "Louisville poner piso",
  "Louisville arreglar drywall",
  "Louisville terminar sotano",
  
  // =============================================================
  // 6. CERCAS & PORTONES (FENCING & GATES)
  // =============================================================
  "Louisville fence installation",
  "Louisville privacy fence builder",
  "Louisville wood fence repair",
  "Clarksville IN fence installation",
  "New Albany IN fence builder",
  "Louisville instalar cerca",
  "Louisville cerca de madera",
  "Louisville cerca de vinilo",
  "Louisville arreglar porton",
  
  // =============================================================
  // 7. CONCRETO, PAVIMENTACIÓN & ALBAÑILERÍA (CONCRETE & MASONRY)
  // =============================================================
  "Louisville concrete driveway",
  "Louisville concrete patio slab",
  "Louisville retaining wall contractor",
  "Louisville who do you use for concrete",
  "Clarksville IN concrete driveway",
  "New Albany IN concrete contractor",
  "Southern Indiana concrete driveway",
  "Louisville vaciado de concreto",
  "Louisville entrada de carro concreto",
  "Louisville patio de concreto",
  
  // =============================================================
  // 8. OBRA NUEVA & BÚSQUEDA GENERAL DE CONTRATISTAS (GENERAL CONTRACTORS)
  // =============================================================
  "Louisville custom home builder",
  "Louisville ISO contractor",
  "Louisville ISO handyman",
  "Louisville anyone know a good contractor",
  "Clarksville ISO contractor",
  "Floyds Knobs IN ISO contractor",
  "Sellersburg IN contractor recommendation",
  "Louisville alguien me recomienda",
  "Louisville alguien conoce a un buen",
  "Louisville quien me hace un estimado",
  "Louisville referencias de contratista",
  "Louisville quien me cotiza",
  "New Albany busco quien",
  "Jeffersonville alguien me recomienda",
  "Clarksville busco contratista"
];

export async function collectFacebookGroupLeads(): Promise<ConstructionLead[]> {
  console.log("\n=================================================================");
  console.log("👥 RADAR DE FACEBOOK: TODAS LAS LÍNEAS DE CONSTRUCCIÓN (KY & IN) 👥");
  console.log("=================================================================");

  const leads: ConstructionLead[] = [];
  const seenTexts = new Set<string>();

  const statePath = path.join(__dirname, "../../../browser_profiles/facebook_state.json");
  if (!fs.existsSync(statePath)) {
    console.warn("[FACEBOOK WARN] No se encontró 'facebook_state.json'.");
    return [];
  }

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"]
    });

    const context = await browser.newContext({
      storageState: statePath,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 }
    });

    const page = await context.newPage();

    // -------------------------------------------------------------
    // FASE 1: MURO DE GRUPOS ACTIVOS (/groups/feed/)
    // -------------------------------------------------------------
    console.log("\n[FASE 1] Escaneando Muro General de Grupos (/groups/feed/)...");
    try {
      await page.goto("https://www.facebook.com/groups/feed/", { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(3000);

      for (let s = 1; s <= 8; s++) {
        await page.mouse.wheel(0, 2000);
        await page.waitForTimeout(1600);
      }

      const groupPosts = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('div[role="feed"] > div, div[role="article"], div.x1yztbdb, div[data-ad-preview="message"]'));
        return els.map(el => {
          const text = (el as HTMLElement).innerText || "";
          const linkEl = (el.querySelector('a[href*="/posts/"], a[href*="/groups/"], a[href*="/permalink/"]') as HTMLAnchorElement);
          const link = linkEl ? linkEl.href : window.location.href;
          const authorEl = el.querySelector('strong, h2, h3, h4, a[role="link"]');
          const author = authorEl ? (authorEl as HTMLElement).innerText.trim() : "Miembro de Grupo";

          return { author, text, link };
        }).filter(p => p.text.length > 25);
      });

      console.log(`  📥 ${groupPosts.length} publicaciones de grupos inspeccionadas.`);

      for (const p of groupPosts) {
        const hashKey = p.text.substring(0, 90).trim();
        if (seenTexts.has(hashKey)) continue;
        seenTexts.add(hashKey);

        const evaluation = await classifyFacebookLead(p.text, p.author, p.link);
        if (evaluation.isValidConstruction && evaluation.category) {
          const leadId = `LEAD_FB_${crypto.createHash("md5").update(hashKey).digest("hex").substring(0, 12)}`;
          const lead: ConstructionLead = {
            leadId,
            category: evaluation.category,
            triggerEvent: "SOCIAL_INTENT_POST",
            address: "Grupo Comunitario (Louisville / Sur de IN)",
            county: "Clark / Floyd / Jefferson",
            state: "KY / IN",
            ownerName: p.author,
            ownerPhones: [],
            ownerEmails: [],
            propertyType: "Residential",
            estimatedProjectValue: evaluation.estimatedValue || 6500,
            triggerDate: new Date().toISOString().split("T")[0],
            urgencyLevel: evaluation.urgency || "HIGH",
            sourcePortal: "Facebook Groups Feed (/groups/feed/)",
            rawDetails: `${evaluation.summarySpanish}\n💬 Texto original: "${p.text.substring(0, 220)}..."\n🔗 Enlace directo al Post: ${p.link}`,
            permitNumber: p.link
          };

          await saveConstructionLead(lead);
          leads.push(lead);
          console.log(`  ✅ [LEAD GRUPO APROBADO] (${lead.category}) "${p.author}" -> ${evaluation.summarySpanish}`);
        }
      }
    } catch (gErr: any) {
      console.warn(`[FASE 1 WARN] Error en Groups Feed: ${gErr.message}`);
    }

    // -------------------------------------------------------------
    // FASE 2: BÚSQUEDAS ESTRUCTURADAS DE TODAS LAS LÍNEAS DE CONSTRUCCIÓN
    // -------------------------------------------------------------
    console.log(`\n[FASE 2] Ejecutando ${ALL_TRADES_CONSTRUCTION_QUERIES.length} consultas en todas las líneas de obra (KY & IN)...`);

    for (const q of ALL_TRADES_CONSTRUCTION_QUERIES) {
      try {
        console.log(`  🔎 Buscando: "${q}"...`);
        await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(1500);

        const searchInput = await page.$('input[placeholder*="Buscar"], input[placeholder*="Search"], input[aria-label*="Buscar"], input[aria-label*="Search"]');
        if (!searchInput) continue;

        await searchInput.click();
        await searchInput.fill(q);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(4000);

        for (let i = 0; i < 3; i++) {
          await page.mouse.wheel(0, 1600);
          await page.waitForTimeout(1200);
        }

        const searchPosts = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('div[role="feed"] > div, div[role="article"], div.x1yztbdb, div[data-ad-preview="message"]'));
          return els.map(el => {
            const text = (el as HTMLElement).innerText || "";
            const linkEl = (el.querySelector('a[href*="/posts/"], a[href*="/groups/"], a[href*="/permalink/"]') as HTMLAnchorElement);
            const link = linkEl ? linkEl.href : window.location.href;
            const authorEl = el.querySelector('strong, h2, h3, h4, a[role="link"]');
            const author = authorEl ? (authorEl as HTMLElement).innerText.trim() : "Vecino de Facebook";

            return { author, text, link };
          }).filter(p => p.text.length > 25);
        });

        console.log(`    📊 ${searchPosts.length} posts detectados para "${q}".`);

        const isIndiana = q.includes("New Albany") || q.includes("Jeffersonville") || q.includes("Clarksville") || q.includes("Floyds Knobs") || q.includes("Sellersburg") || q.includes("Southern Indiana");
        const locationTag = isIndiana ? "Sur de Indiana (IN)" : "Louisville Metro (KY)";

        for (const p of searchPosts.slice(0, 12)) {
          const hashKey = p.text.substring(0, 90).trim();
          if (seenTexts.has(hashKey)) continue;
          seenTexts.add(hashKey);

          const evaluation = await classifyFacebookLead(p.text, p.author, p.link);
          if (evaluation.isValidConstruction && evaluation.category) {
            const leadId = `LEAD_FB_${crypto.createHash("md5").update(hashKey).digest("hex").substring(0, 12)}`;
            const lead: ConstructionLead = {
              leadId,
              category: evaluation.category,
              triggerEvent: "SOCIAL_INTENT_POST",
              address: `Comunidad de ${locationTag}`,
              county: isIndiana ? "Clark / Floyd" : "Jefferson",
              state: isIndiana ? "IN" : "KY",
              ownerName: p.author,
              ownerPhones: [],
              ownerEmails: [],
              propertyType: "Residential",
              estimatedProjectValue: evaluation.estimatedValue || 6500,
              triggerDate: new Date().toISOString().split("T")[0],
              urgencyLevel: evaluation.urgency || "HIGH",
              sourcePortal: `Facebook Search ("${q}")`,
              rawDetails: `${evaluation.summarySpanish}\n💬 Texto original: "${p.text.substring(0, 220)}..."\n🔗 Enlace directo al Post: ${p.link}`,
              permitNumber: p.link
            };

            await saveConstructionLead(lead);
            leads.push(lead);
            console.log(`    ✅ [LEAD RADAR APROBADO - ${isIndiana ? 'SUR DE IN' : 'KY'}] (${lead.category}) "${p.author}" -> ${evaluation.summarySpanish}`);
          }
        }
      } catch (sErr: any) {
        console.warn(`    ⚠️ Error en búsqueda "${q}": ${sErr.message}`);
      }
    }

  } catch (err: any) {
    console.error(`[FACEBOOK ERR] ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }

  console.log("\n=================================================================");
  console.log(`🎉 [RESUMEN TOTAL KY + SUR DE IN] ${leads.length} LEADS CALIFICADOS CAPTURADOS`);
  console.log("=================================================================\n");
  return leads;
}
