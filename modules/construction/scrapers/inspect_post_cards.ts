import { chromium } from "playwright";
import * as path from "path";

async function inspectPostCardSelectors() {
  const statePath = path.join(__dirname, "../../../browser_profiles/linkedin_state.json");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/search/results/all/?keywords=Louisville%20subcontractors", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  const postTab = page.locator("button:has-text('Publicaciones'), a:has-text('Publicaciones'), button:has-text('Posts')").first();
  await postTab.click();
  await page.waitForTimeout(6000);

  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(1000);
  }

  const posts = await page.evaluate(() => {
    // Buscar todos los bloques que tengan texto de publicaciones
    const articles = Array.from(document.querySelectorAll("div, article, li")).filter(el => {
      const text = (el as HTMLElement).innerText || "";
      return text.includes("Publicación en el feed") || text.includes("🚨") || (text.includes("Louisville") && text.includes("contract") && text.length < 2500 && text.length > 150);
    });

    return articles.slice(0, 6).map(el => {
      const text = (el as HTMLElement).innerText.replace(/\n+/g, " \n ");
      const links = Array.from(el.querySelectorAll("a")).map(a => a.href);
      return { text: text.substring(0, 300), links: links.slice(0, 3) };
    });
  });

  console.log("Publicaciones extraídas:", JSON.stringify(posts, null, 2));
  await browser.close();
}

inspectPostCardSelectors().catch(console.error);
