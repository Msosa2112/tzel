import { chromium } from "playwright";

async function testBingDecoding() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const query = 'linkedin.com/posts Louisville subcontractors';
  console.log(`Navegando a Bing: ${query}...`);
  await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-us`);
  await page.waitForTimeout(3000);

  const results = await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll("li.b_algo"));
    return blocks.map(b => {
      const title = b.querySelector("h2 a")?.textContent || "";
      const cite = b.querySelector("cite, .b_attribution cite")?.textContent || "";
      const snippet = b.querySelector("p, .b_caption p")?.textContent || "";
      const rawHref = (b.querySelector("h2 a") as HTMLAnchorElement)?.href || "";
      return { title, cite, rawHref, snippet };
    });
  });

  console.log("Resultados Bing:", results.slice(0, 5));
  await browser.close();
}

testBingDecoding().catch(console.error);
