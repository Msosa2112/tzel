import { chromium } from "playwright";
import * as path from "path";

async function testFacebookLiveSearch() {
  const statePath = path.join(__dirname, "../../../browser_profiles/facebook_state.json");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  console.log("1. Navegando al Home de Facebook con sesión activa...");
  await page.goto("https://www.facebook.com/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const searchInput = await page.$('input[placeholder*="Buscar"], input[placeholder*="Search"], input[aria-label*="Buscar"], input[aria-label*="Search"]');

  if (searchInput) {
    console.log("2. Escribiendo en el buscador: 'Louisville need roofer'...");
    await searchInput.click();
    await searchInput.fill("Louisville need roofer");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(6000);

    console.log("3. URL resultante:", page.url());
    console.log("Título:", await page.title());

    // Scroll para cargar más publicaciones
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(3000);

    const ssPath = path.join(__dirname, "../../../browser_profiles/fb_search_results.png");
    await page.screenshot({ path: ssPath });
    console.log("Captura de búsqueda guardada en:", ssPath);

    // Extraer texto de publicaciones
    const posts = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('div[role="feed"] > div, div[role="article"], div.x1yztbdb'));
      return els.map(el => {
        const text = (el as HTMLElement).innerText || "";
        const link = (el.querySelector('a[href*="/posts/"], a[href*="/groups/"]') as HTMLAnchorElement)?.href || "";
        return { text: text.substring(0, 300), link };
      }).filter(p => p.text.length > 30);
    });

    console.log(`4. Publicaciones detectadas (${posts.length}):`);
    posts.slice(0, 3).forEach((p, idx) => {
      console.log(`\n--- Post #${idx + 1} ---`);
      console.log(p.text);
      console.log(`Enlace: ${p.link}`);
    });
  }

  await browser.close();
}

testFacebookLiveSearch().catch(console.error);
