import { chromium } from "playwright";

async function testGooglePlaywrightSearch() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });

  const query = 'site:linkedin.com/posts "Louisville" "subcontractors"';
  console.log(`Navegando a Google: ${query}...`);
  await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const results = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a"));
    return anchors
      .map(a => ({ title: a.innerText.trim(), href: a.href }))
      .filter(a => a.href.includes("linkedin.com") && a.title.length > 10);
  });

  console.log(`Resultados de LinkedIn encontrados: ${results.length}`);
  if (results.length > 0) {
    console.log(results.slice(0, 5));
  } else {
    console.log("Título de la página de Google:", await page.title());
  }

  await browser.close();
}

testGooglePlaywrightSearch().catch(console.error);
