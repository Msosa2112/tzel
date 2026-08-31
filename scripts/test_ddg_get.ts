import axios from "axios";
import * as cheerio from "cheerio";

async function testDDGGet(address: string) {
  const q = `${address} Louisville KY`;
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
  console.log(`GET ${url}`);

  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      timeout: 10000
    });

    const $ = cheerio.load(res.data);
    console.log("HTML length:", res.data.length);

    const items: any[] = [];
    $("td.result-snippet, a.result-link").each((_, el) => {
      const text = $(el).text().trim();
      items.push(text);
    });

    console.log("Items found:", items.slice(0, 10));
  } catch (err: any) {
    console.error("Error:", err.message);
  }
}

testDDGGet("808 Brookline Ave");
