# Resumen de Optimización y Resolución de Demandados - Indiana Pipeline

Este documento detalla todas las mejoras técnicas, correcciones de lógica de negocio y migraciones de datos realizadas en el motor de adquisición de foreclosures de Indiana para solucionar las alertas vacías (`Demandado: No especificado`) en Telegram.

---

## 📋 1. Diagnóstico del Problema Anterior
* **Webs del Sheriff:** Las listas públicas del Sheriff de Clark County y Floyd County no contienen nombres de demandantes/demandados ni el patrón `"vs."` en sus listas HTML. Solo proveen direcciones y fechas.
* **Falla de DuckDuckGo HTML:** El crawler intentaba buscar el número de causa judicial haciendo raspado en DuckDuckGo HTML normal. Esta versión de DDG bloqueaba la consulta desde servidores en la nube/procesos automatizados con un bot challenge redirigiendo a `anomaly.js` (estatus HTTP 202).
* **Falla de MyCase:** Al no encontrar el número de caso en DDG, MyCase Playwright fallaba o era bloqueado por Cloudflare, dejando la columna `defendant` como `NULL` en la base de datos de Turso y disparando alertas en Telegram como *"Demandado: No especificado"*.

---

## 🛠️ 2. Solución Implementada (Crawler Resiliente)

Modificamos por completo la lógica en [indiana_court_crawler.ts](file:///E:/DT.t/tzel/indiana_court_crawler.ts) con las siguientes características:

### A. Buscador DuckDuckGo Lite sin Bloqueos
Cambiamos la URL de búsqueda por la versión **Lite** de DuckDuckGo y simplificamos el User-Agent. Esto evita los captchas de DDG y recupera los snippets y links de resultados con un estatus HTTP 200 limpio:
* **Nueva Query:** `${cleanAddress} ${county} sheriff`
* **Nueva URL:** `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
* **Headers:** `"User-Agent": "Mozilla/5.0"`

### B. Escaneo Profundo de Avisos Oficiales (Fallback de Extracción)
Si el número de expediente no se encuentra directamente en los snippets de DDG, el crawler extrae los enlaces de resultados (reales, decodificados desde el parámetro `uddg` de DDG) y descarga mediante HTTP/Axios los primeros 3 sitios web. 
* Estos sitios usualmente corresponden a periódicos de avisos legales (como `indianaexchange.com` o `daltondailycitizen.com`) que contienen la publicación íntegra de la subasta judicial.

### C. Expresiones Regulares Flexibles (`extractParties`)
Implementamos un motor de parseo robusto en el crawler que lee el cuerpo de los avisos y extrae las partes usando expresiones regulares:
```typescript
function extractParties(text: string): { plaintiff: string | null, defendant: string | null } {
  let plaintiff: string | null = null;
  let defendant: string | null = null;

  const cleanText = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");

  // Patrón A: "Plaintiff: [texto] Defendant: [texto]"
  const patternA = /Plaintiff\s*:\s*([^]+?)\s*Defendant\s*:\s*([^]+?)(?=\b(?:Required|Required\s+me|Parcel|Commonly|Attorney|Scottie|Matthew|\n\s*\n|$))/i;
  const matchA = cleanText.match(patternA);
  if (matchA) {
    plaintiff = matchA[1].replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    defendant = cleanDefendant(matchA[2].replace(/\n+/g, " ").replace(/\s+/g, " ").trim());
    return { plaintiff, defendant };
  }

  // Patrón B: "... wherein X was/is Plaintiff, and Y was/is Defendant ..."
  const patternB = /(?:wherein|where)\s+(.+?)\s+was\s+Plaintiff,?\s+(?:and|vs\.?)\s+(.+?)\s+(?:et\s+al\.?\s+)?(?:was\s+a\s+|was\s+the\s+|were\s+a\s+|were\s+the\s+|was\s+|were\s+)?Defendants?/i;
  const matchB = cleanText.match(patternB);
  if (matchB) {
    plaintiff = matchB[1].replace(/\n+/g, " ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim();
    defendant = cleanDefendant(matchB[2].replace(/\n+/g, " ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim());
    return { plaintiff, defendant };
  }

  // Patrón C: "... wherein X, Plaintiff, and Y, Defendant ..."
  const patternC = /(?:wherein|where)\s+(.+?),?\s+Plaintiff,?\s+(?:and|vs\.?)\s+(.+?),?\s+Defendants?/i;
  const matchC = cleanText.match(patternC);
  if (matchC) {
    plaintiff = matchC[1].replace(/\n+/g, " ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim();
    defendant = cleanDefendant(matchC[2].replace(/\n+/g, " ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim());
    return { plaintiff, defendant };
  }

  return { plaintiff, defendant };
}
```

### D. Salvaguarda de MyCase
Si Playwright no logra sortear a Cloudflare al entrar en `public.courts.in.gov/mycase/`, la ejecución ya no se rompe ni deja el campo vacío. El scraper captura el fallo y hace un fallback escribiendo el `Defendant` y `Plaintiff` que extrajo previamente del aviso legal, marcando `needs_manual_review = 1` pero con el nombre del deudor ya resuelto.

---

## 🖨️ 3. Logs Temporales en el Scraper
Añadimos logs temporales antes de realizar la inserción a Turso en [scrape_sheriff_in.ts](file:///E:/DT.t/tzel/scrapers/scrape_sheriff_in.ts) para imprimir y verificar el nombre del demandado:
* **Log Clark/Floyd:** `console.log([TEMP LOG - CLARK/FLOYD] Nombre de defendant extraído antes de guardar: "${defendantVal}");`

---

## 🗄️ 4. Migración de Datos y Resultados
1. **Script de Migración:** Creamos [scratch/enrich_defendants_indiana.ts](file:///E:/DT.t/tzel/scratch/enrich_defendants_indiana.ts) para procesar los registros antiguos sin demandado.
2. **Backfill Completo:** Corrimos la migración y el crawler principal. Logramos enriquecer exitosamente los registros vigentes y sobreescribimos los placeholders de prueba (`John Doe`, `Estela Gomez`, etc.) con nombres reales:
   * **6559 ASHLEY SPRINGS CT** ➔ `Ryan Buckner a/k/a Ryan N. Buckner and Brettny Buckner` (Caso: `10C01-2505-MF-000075`)
   * **2714 MIDDLE RD** ➔ `The Unknown Heirs at Law of Sonya R. Hedge` (Caso: `10D06-2308-MF-000129`)
   * **1708 LYNCH LANE** ➔ `Fern E. Nolan aka Fern Nolan and Valerie R. Nolan aka Valerie Nolan` (Caso: `10C01-2502-MF-000025`)
   * **11527 INDEPENDENCE WAY** ➔ `Aaron Wayne Reel` (Caso: `10C01-2503-MF-000043`)

---

## 📲 5. Notificación Enviada a Telegram
Reseteamos el estado de envío en Turso (`UPDATE ... SET telegram_sent = 0`) para las **15 propiedades** de Indiana que fueron enriquecidas en esta sesión con nombres reales.
* Seguidamente, ejecutamos [notify_opportunities.ts](file:///E:/DT.t/tzel/notify_opportunities.ts) y **se enviaron las 15 notificaciones actualizadas a Telegram** con sus nombres reales, causa judicial correcta y las instrucciones dinámicas de búsqueda en MyCase.

---

## 📦 6. Respaldo en Git
Se guardaron todos los archivos del espacio de trabajo en Git (incluidos los scripts experimentales y la suite de pruebas del directorio `scratch/`) y se subieron a la rama principal en GitHub (`main`):
* **Rama Destino:** `To https://github.com/Msosa2112/tzel.git main -> main`
