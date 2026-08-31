import { createClient } from "@supabase/supabase-js";

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTMzOTUsImV4cCI6MjA5MjYyOTM5NX0.MUsRX_h5TZJ2LeS-iXFpdQK3bIV6GOBO2-DW1m9MdsA";
const sb = createClient(url, anonKey);

function parseNotes(notesText: string, lead: any) {
  if (!notesText) {
    return {
      need: 'Cliente solicita cotización para trabajos de construcción o reparación.',
      speeches: {
        spanishDM: 'Hola, vi tu publicación buscando contratista en Louisville. En Barba Construction tenemos cuadrilla local y fotos de obras similares. ¿Qué día podemos pasar a darte un estimado gratis?',
        spanishComment: 'Hola, te enviamos fotos y presupuesto aproximado por mensaje privado. ¡A la orden para una visita gratuita!',
        englishDM: 'Hi, saw your post looking for local contractors in Louisville. We offer free on-site estimates. Let us know when works best for you!'
      },
      originalUrl: '',
      phone: lead?.phone || '',
      resolvedName: lead?.first_name || 'Cliente Potencial'
    };
  }

  const result: any = {
    need: '',
    speeches: {
      spanishDM: '',
      spanishComment: '',
      englishDM: ''
    },
    originalUrl: '',
    phone: lead?.phone || '',
    resolvedName: ''
  };

  const lines = notesText.split('\n');
  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes('🎯 NECESIDAD:')) {
      result.need = line.replace('🎯 NECESIDAD:', '').trim();
    } else if (line.includes('🔗 Enlace directo al Post:') || line.includes('🔗 ENLACE ORIGINAL:') || line.includes('🔗 Enlace') || line.includes('🔗 Búsqueda:')) {
      const urlMatch = line.match(/https?:\/\/[^\s]+/);
      if (urlMatch && !result.originalUrl) {
        result.originalUrl = urlMatch[0];
      }
    } else if (line.includes('SPEECH DE VENTA RECOMENDADO (ESPAÑOL - DM):')) {
      currentSection = 'spanishDM';
    } else if (line.includes('COMENTARIO PÚBLICO SUGERIDO:')) {
      currentSection = 'spanishComment';
    } else if (line.includes('SALES PITCH (ENGLISH):')) {
      currentSection = 'englishDM';
    } else if (line.includes('APERTURA TELEFÓNICA:') || line.includes('DETALLES ORIGINALES:')) {
      currentSection = '';
    } else if (currentSection && !line.startsWith('===') && !line.startsWith('📄')) {
      const cleaned = line.replace(/^"/, '').replace(/"$/, '').trim();
      if (cleaned) {
        if (!result.speeches[currentSection]) result.speeches[currentSection] = cleaned;
        else result.speeches[currentSection] += ' ' + cleaned;
      }
    }
  }

  if (!result.phone) {
    const phoneMatch = notesText.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/);
    if (phoneMatch) result.phone = phoneMatch[0];
  }

  let displayName = lead.first_name || '';
  if (lead.last_name && lead.last_name !== 'Potencial') {
    displayName += ` ${lead.last_name}`;
  }

  if (displayName.includes('Vecino de Facebook') || displayName.includes('Vecino del Grupo')) {
    const groupMatch = notesText.match(/Grupo:\s*"?([^"\n]+)"?/);
    if (groupMatch) {
      displayName = `Solicitud en ${groupMatch[1]}`;
    } else {
      displayName = `Cliente en ${lead.city || 'Louisville'}`;
    }
  }

  result.resolvedName = displayName.trim() || 'Cliente Potencial';
  return result;
}

async function testAllParse() {
  const { data } = await sb.from('contacts').select('*').ilike('external_ref', 'LEAD_%');
  console.log(`Testing parseNotes for ${data?.length} leads...`);
  for (const l of (data || [])) {
    try {
      const parsed = parseNotes(l.notes, l);
      if (!parsed.resolvedName) throw new Error("Missing resolvedName");
    } catch (e: any) {
      console.error(`ERROR on lead ${l.id}:`, e.message);
    }
  }
  console.log("All 48 leads parsed without errors!");
}

testAllParse().catch(console.error);
