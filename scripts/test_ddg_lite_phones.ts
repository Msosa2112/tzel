import axios from "axios";
import * as cheerio from "cheerio";
import { makeGotScrapingRequest } from "../scrapers/got_scraping_helper";

async function testDDGLite(address: string, city: string = "Louisville", state: string = "KY") {
  console.log(`\n=============================================================`);
  console.log(`🦆 Probando DuckDuckGo Lite para: "${address}", ${city}, ${state}`);
  console.log(`=============================================================`);

  // Estrategia 1: Búsqueda directa de la dirección con palabras clave de contacto
  const queries = [
    `"${address}" "${city}"`,
    `"${address}" "${city}" phone`,
    `site:clustrmaps.com "${address}" "${city}"`,
    `site:radaris.com "${address}" "${city}"`,
    `site:cyberbackgroundchecks.com "${address}" "${city}"`
  ];

  for (const q of queries) {
    console.log(`\n🔍 Query: ${q}`);
    const url = `https://lite.duckduckgo.com/lite/`;

    try {
      // DuckDuckGo Lite acepta POST con parámetro `q`
      const res = await axios.post(url, `q=${encodeURIComponent(q)}`, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        },
        timeout: 10000
      });

      const $ = cheerio.load(res.data);
      const results: { title: string; snippet: string; link: string; phones: string[] }[] = [];

      $("tr").each((_, tr) => {
        const linkEl = $(tr).find(".result-link");
        const snippetEl = $(tr).find(".result-snippet");
        if (linkEl.length > 0) {
          const title = linkEl.text().trim();
          const link = linkEl.attr("href") || "";
          const snippet = snippetEl.text().trim();
          const phoneMatches = `${title} ${snippet}`.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/g) || [];

          if (title || snippet) {
            results.push({
              title,
              snippet,
              link,
              phones: Array.from(new Set(phoneMatches))
            });
          }
        }
      });

      console.log(`  📥 Resultados devueltos por DDG Lite: ${results.length}`);
      results.slice(0, 4).forEach((r, idx) => {
        console.log(`  [${idx + 1}] Titulo: ${r.title}`);
        console.log(`      Snippet: ${r.snippet}`);
        if (r.phones.length > 0) {
          console.log(`      🎯 TELÉFONOS ENCONTRADOS:`, r.phones);
        }
      });

      if (results.some(r => r.phones.length > 0)) {
        console.log(`  🎉 ¡Éxito con query "${q}"!`);
      }
    } catch (err: any) {
      console.error(`  ❌ Error en DDG Lite: ${err.message}`);
    }
  }
}

async function run() {
  await testDDGLite("808 Brookline Ave", "Louisville", "KY");
  await testDDGLite("319 E St Catherine St", "Louisville", "KY");
}

run();
