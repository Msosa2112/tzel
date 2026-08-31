import axios from "axios";
import * as cheerio from "cheerio";
import { makeGotScrapingRequest } from "../scrapers/got_scraping_helper";

async function testDuckDuckGo(address: string, city: string = "Louisville", state: string = "KY") {
  console.log(`\n🦆 Buscando vía DuckDuckGo OSINT para: "${address}" ${city} ${state}...`);
  const query = `"${address}" "${city}" phone OR "phone number" OR "owner"`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const res = await makeGotScrapingRequest(url);
    const $ = cheerio.load(res.body);
    const snippets: string[] = [];

    $(".result__snippet").each((_, el) => {
      snippets.push($(el).text().trim());
    });

    console.log(`📄 Snippets encontrados (${snippets.length}):`);
    snippets.forEach((s, idx) => {
      console.log(`  [${idx + 1}] ${s}`);
      const phones = s.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/g);
      if (phones) {
        console.log(`     🎯 TELÉFONOS DETECTADOS EN SNIPPET:`, phones);
      }
    });
  } catch (err: any) {
    console.error("Error DDG:", err.message);
  }
}

async function testFastPeopleSearchDuck(address: string, city: string = "Louisville", state: string = "KY") {
  console.log(`\n🔍 Buscando perfiles indexados de FastPeopleSearch / TruePeopleSearch...`);
  const query = `site:fastpeoplesearch.com OR site:truepeoplesearch.com "${address}" "${city}"`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const res = await makeGotScrapingRequest(url);
    const $ = cheerio.load(res.body);
    const results: any[] = [];

    $(".result").each((_, el) => {
      const title = $(el).find(".result__title").text().trim();
      const snippet = $(el).find(".result__snippet").text().trim();
      const link = $(el).find(".result__url").text().trim();
      results.push({ title, snippet, link });
    });

    console.log(`📋 Resultados de Sitios de Personas (${results.length}):`, JSON.stringify(results, null, 2));
  } catch (err: any) {
    console.error("Error DDG FastPeopleSearch:", err.message);
  }
}

async function run() {
  await testDuckDuckGo("808 Brookline Ave", "Louisville", "KY");
  await testFastPeopleSearchDuck("808 Brookline Ave", "Louisville", "KY");
}

run();
