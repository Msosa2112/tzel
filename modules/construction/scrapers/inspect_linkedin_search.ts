import { chromium } from "playwright";
import * as path from "path";

async function inspectSearchResults() {
  const statePath = path.join(__dirname, "../../../browser_profiles/linkedin_state.json");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  console.log("Cargando búsqueda en LinkedIn...");
  await page.goto("https://www.linkedin.com/search/results/content/?keywords=Louisville%20subcontractors", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // Hacer scroll para cargar posts
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1000);
  }

  const pageDetails = await page.evaluate(() => {
    const listItems = Array.from(document.querySelectorAll("li, .reusable-search__result-container, .feed-shared-update-v2, div[data-view-name]"));
    const textBlocks = listItems.map(el => {
      const text = (el as HTMLElement).innerText || "";
      const links = Array.from(el.querySelectorAll("a")).map(a => (a as HTMLAnchorElement).href);
      return { text: text.substring(0, 180).replace(/\n+/g, " "), linkCount: links.length, firstLink: links[0] || "" };
    }).filter(b => b.text.length > 40);

    return {
      title: document.title,
      url: window.location.href,
      totalBlocks: textBlocks.length,
      sample: textBlocks.slice(0, 8)
    };
  });

  console.log("Detalles de resultados:", JSON.stringify(pageDetails, null, 2));

  const screenshotPath = path.join(__dirname, "../../../browser_profiles/linkedin_search_preview_authenticated.png");
  await page.screenshot({ path: screenshotPath });
  console.log(`📸 Captura guardada en ${screenshotPath}`);

  await browser.close();
}

inspectSearchResults().catch(console.error);
