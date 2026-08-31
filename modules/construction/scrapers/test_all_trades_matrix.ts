import { evaluateIntentWithPillars } from "../leads/facebook_group_collector";

const testCases = [
  // 1. Canaletas & Bajantes
  { text: "ISO someone to clean and repair our gutters in Louisville", author: "Sarah Jenkins", expected: true },
  { text: "¿Alguien me recomienda quién ponga canaletas y bajantes para el agua de lluvia?", author: "Carlos Perez", expected: true },

  // 2. Siding & Fascia
  { text: "Looking for a contractor to replace damaged vinyl siding and wrap fascia", author: "Mike Ross", expected: true },
  { text: "Busco persona que me haga presupuesto para poner siding y metal en una casa", author: "Juan Martinez", expected: true },

  // 3. Extensiones & Ampliaciones
  { text: "Looking into building a detached garage and room addition on our property", author: "Dave Miller", expected: true },
  { text: "Necesito un estimado para ampliar la casa y extender el techo 30 pies", author: "Roberto Gomez", expected: true },

  // 4. Porches & Decks
  { text: "Anyone know a good carpenter to build a screened front porch and composite deck?", author: "Amanda Lee", expected: true },
  { text: "¿Quién me hace una pérgola y una terraza de madera para el patio?", author: "Maria Rodriguez", expected: true },

  // 5. Techos & Goteras
  { text: "Tree fell through our bedroom roof destroying rafters, need emergency roofer", author: "John Smith", expected: true },
  { text: "Tengo una gotera fuerte en el techo que se me metió el agua", author: "Elena Lopez", expected: true },

  // 6. Remodelaciones, Cocinas & Sótanos
  { text: "Need quotes for full kitchen cabinets, granite countertop and LVP flooring", author: "Jessica Brown", expected: true },
  { text: "Alguien conoce a un buen albañil para terminar el sótano y colgar drywall", author: "Pedro Sanchez", expected: true },

  // 7. Baños & Duchas
  { text: "ISO bathroom contractor to do a walk-in tile shower and vanity install", author: "Ashley Taylor", expected: true },
  { text: "¿Quién me hace un estimado para remodelar dos baños y cambiar la tina por azulejos?", author: "Luis Morales", expected: true },

  // 8. Cercas
  { text: "Looking for privacy fence installation around our back yard in Clarksville", author: "Tom White", expected: true },
  { text: "Busco instalador para poner cerca de madera y portón", author: "Hector Diaz", expected: true },

  // 9. Concreto
  { text: "Need quotes to pour an 800 sqft concrete driveway and patio slab", author: "Brandon Cole", expected: true },
  { text: "¿Alguien que haga vaciado de concreto y entrada de carro?", author: "Javier Castro", expected: true },

  // 10. EXCLUSIONES: Plomería (Debe ser DESCARTADO)
  { text: "ISO a licensed plumber to replace our hot water heater that is leaking", author: "Plumbing Need", expected: false },
  { text: "Busco plomero urgente para destapar una cañería y cambiar tubería de agua", author: "Plomeria Need", expected: false },

  // 11. EXCLUSIONES: Electricidad (Debe ser DESCARTADO)
  { text: "Need an electrician to rewire our breaker panel and install new outlets", author: "Electric Need", expected: false },
  { text: "Busco electricista para arreglar un cortocircuito en el panel principal", author: "Electricista Need", expected: false },

  // 12. EXCLUSIONES: Autopromoción Contratista (Debe ser DESCARTADO)
  { text: "Ofrecemos todo tipo de servicios de remodelación y techos, llámanos al 502-555-0199 presupuestos gratis", author: "Contractor Ad", expected: false }
];

console.log("=================================================================");
console.log("🧪 PRUEBA DE MATRIZ DE OFICIOS Y EXCLUSIONES ESTRICTAS (TZEL)");
console.log("=================================================================\n");

let passed = 0;
for (const tc of testCases) {
  const result = evaluateIntentWithPillars(tc.text, tc.author);
  const success = result.isValidConstruction === tc.expected;
  if (success) {
    passed++;
    console.log(`✅ [OK] "${tc.author}": ${result.isValidConstruction ? `APROBADO -> ${result.category} ($${result.estimatedValue})` : `RECHAZADO -> ${result.rejectedReason}`}`);
  } else {
    console.error(`❌ [FALLO] "${tc.author}": Esperado ${tc.expected}, pero obtuvo ${result.isValidConstruction}. Razón: ${result.rejectedReason}`);
  }
}

console.log(`\n=================================================================`);
console.log(`📊 RESULTADO DE LA VALIDACIÓN: ${passed}/${testCases.length} Casos Pasaron con Éxito`);
console.log("=================================================================\n");
