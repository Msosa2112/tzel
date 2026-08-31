import axios from "axios";
import * as cheerio from "cheerio";
import * as fs from "fs";

async function inspectDDG() {
  const url = "https://lite.duckduckgo.com/lite/?q=808+Brookline+Ave+Louisville+KY";
  const res = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  const $ = cheerio.load(res.data);
  const text = $("body").text().replace(/\s+/g, " ");
  console.log("Body text snippet:\n", text.substring(0, 1000));

  // Ver los elementos td, a, tr
  const results: any[] = [];
  $("table tr").each((_, tr) => {
    const link = $(tr).find("a.result-link, a").text().trim();
    const snippet = $(tr).find(".result-snippet, td").text().trim();
    if (link && snippet && !link.includes("DuckDuckGo")) {
      results.push({ link, snippet: snippet.substring(0, 150) });
    }
  });

  console.log("Results parsed:", results.slice(0, 5));
}

inspectDDG();
