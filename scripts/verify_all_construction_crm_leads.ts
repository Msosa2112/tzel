import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import { isValidReachableUSPhone, formatPhoneUs, normalizePhoneNumber } from "../intelligence/phone_classifier";
import * as dotenv from "dotenv";

dotenv.config();

const url = process.env.BARBAPRO_SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = process.env.BARBAPRO_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

const apiKey = process.env.SKIP_TRACE_API_KEY || "eg9xRVBeFh6G1ZLXCREpiYg9hYUY4AzpbfEbZ6jI";

async function verifyAllCRMLeads() {
  console.log("=================================================================");
  console.log("🚀 VERIFICACIÓN AL 100% CON BATCHDATA API (BARBA CRM) 🚀");
  console.log("=================================================================\n");

  const { data: contacts, error } = await sb
    .from("contacts")
    .select("id, first_name, last_name, phone, email, address, city, state, zip, notes, external_ref");

  if (error) {
    console.error("Error cargando contactos:", error);
    return;
  }

  const unverified = (contacts || []).filter(c => {
    const p = (c.phone || "").replace(/\D/g, "");
    return !isValidReachableUSPhone(p) && c.address && c.address.length > 5 && !c.address.startsWith("Grupo:") && !c.address.startsWith("Vecindario");
  });

  console.log(`📋 Total Contactos a Verificar con BatchData: ${unverified.length}\n`);

  let enrichedCount = 0;
  let batchSize = 10;

  for (let i = 0; i < unverified.length; i += batchSize) {
    const chunk = unverified.slice(i, i + batchSize);
    console.log(`⏳ Procesando Lote ${Math.floor(i / batchSize) + 1} de ${Math.ceil(unverified.length / batchSize)} (${chunk.length} prospectos)...`);

    const requests = chunk.map(c => {
      let rawAddr = (c.address || "").split(",")[0].trim();
      let city = c.city || "Louisville";
      let state = c.state || "KY";
      let zipMatch = (c.address || "").match(/\b\d{5}\b/);
      let zip = zipMatch ? zipMatch[0] : (c.zip || "40202");

      return {
        propertyAddress: {
          street: rawAddr,
          city: city,
          state: state,
          zip: zip
        }
      };
    });

    try {
      const response = await axios.post(
        "https://api.batchdata.com/api/v1/property/skip-trace",
        { requests },
        {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          timeout: 30000
        }
      );

      const results = response.data?.results?.persons || [];

      for (let j = 0; j < results.length; j++) {
        const person = results[j];
        const originalLead = chunk[j];

        if (!person || !person.meta?.matched) continue;

        const fullName = person.name?.full || `${person.name?.first || ''} ${person.name?.last || ''}`.trim() || originalLead.first_name;
        const firstName = person.name?.first || originalLead.first_name || "Propietario";
        const lastName = person.name?.last || originalLead.last_name || "Inmueble";

        // Ordenar y priorizar móviles
        const phoneList = (person.phoneNumbers || [])
          .filter((p: any) => p.number && isValidReachableUSPhone(p.number.replace(/\D/g, "")))
          .sort((a: any, b: any) => {
            const isMobA = a.type === "Mobile" ? 1 : 0;
            const isMobB = b.type === "Mobile" ? 1 : 0;
            if (isMobB !== isMobA) return isMobB - isMobA;
            return (b.score || 0) - (a.score || 0);
          });

        const primaryPhone = phoneList.length > 0 ? formatPhoneUs(normalizePhoneNumber(phoneList[0].number)) : null;
        const allPhonesStr = phoneList.map((p: any) => `${p.type || 'Tel'}: ${formatPhoneUs(normalizePhoneNumber(p.number))}`).join(", ");
        const primaryEmail = (person.emails && person.emails.length > 0) ? person.emails[0].email : originalLead.email;

        if (primaryPhone) {
          let updatedNotes = originalLead.notes || "";
          if (fullName && updatedNotes.includes("Propietario Registrado: Propietario Inmueble")) {
            updatedNotes = updatedNotes.replace("Propietario Registrado: Propietario Inmueble", `Propietario Registrado: ${fullName}`);
          }
          if (fullName && updatedNotes.includes("Propietario Inmueble")) {
            updatedNotes = updatedNotes.replace(/Propietario Inmueble/g, fullName);
          }
          if (!updatedNotes.includes("✅ VERIFICADO CON BATCHDATA:")) {
            updatedNotes += `\n\n✅ VERIFICADO CON BATCHDATA:\n👤 Titular Confirmado: ${fullName}\n📞 Teléfonos: ${allPhonesStr}\n📧 Email: ${primaryEmail || 'N/A'}`;
          }

          const { error: upErr } = await sb
            .from("contacts")
            .update({
              first_name: firstName,
              last_name: lastName,
              phone: primaryPhone,
              email: primaryEmail,
              notes: updatedNotes,
              updated_at: new Date().toISOString()
            })
            .eq("id", originalLead.id);

          if (!upErr) {
            enrichedCount++;
            console.log(`  ✅ [${enrichedCount}] "${fullName}" | 📱 ${primaryPhone} | 📍 ${originalLead.address}`);
          }
        }
      }
    } catch (apiErr: any) {
      console.error("  ❌ Error en lote BatchData:", apiErr.response?.data || apiErr.message);
    }
  }

  console.log("\n=================================================================");
  console.log(`🎉 VERIFICACIÓN FINALIZADA: ${enrichedCount} nuevos leads verificados al 100%`);
  console.log("=================================================================\n");
}

verifyAllCRMLeads().catch(console.error);
