import { chromium } from "playwright";
import * as path from "path";

async function testLinkedInFeedSearch() {
  const statePath = path.join(__dirname, "../../../browser_profiles/linkedin_state.json");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  console.log("1. Accediendo a LinkedIn Feed...");
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  console.log("2. Buscando input de búsqueda global...");
  const searchInput = page.locator("input.search-global-typeahead__input, input[aria-label*='Buscar'], input[aria-label*='Search']").first();
  await searchInput.click();
  await searchInput.fill("Louisville subcontractors");
  await page.keyboard.press("Enter");

  console.log("3. Esperando carga de resultados...");
  await page.waitForTimeout(5000);

  // Clic en la pestaña "Publicaciones" o "Posts" si aparece
  const postsTab = page.locator("button:has-text('Publicaciones'), button:has-text('Posts'), a:has-text('Publicaciones'), a:has-text('Posts')").first();
  if (await postsTab.isVisible()) {
    console.log("4. Haciendo clic en filtro 'Publicaciones'...");
    await postsTab.click();
    await page.waitForTimeout(4000);
  }

  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(1200);
  }

  const posts = await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll("div.feed-shared-update-v2, div[data-urn*='urn:li:activity'], li.artdeco-list__item"));
    return containers.map(el => {
      const text = (el as HTMLElement).innerText || "";
      const link = (el.querySelector("a[href*='/feed/update/'], a[href*='activity'], a[href*='/posts/']") as HTMLAnchorElement)?.href || "";
      const author = (el.querySelector(".update-components-actor__name, strong, h3, a[href*='/in/']") as HTMLElement)?.innerText || "Contacto LinkedIn";
      return { author, text: text.substring(0, 250).replace(/\n+/g, " "), link };
    }).filter(p => p.text.length > 30);
  });

  console.log(`📊 Publicaciones extraídas con éxito: ${posts.length}`);
  if (posts.length > 0) {
    console.log("Muestra de posts:", JSON.stringify(posts.slice(0, 4), null, 2));
  }

  const screenshotPath = path.join(__dirname, "../../../browser_profiles/linkedin_posts_found.png");
  await page.screenshot({ path: screenshotPath });
  console.log(`📸 Captura guardada en ${screenshotPath}`);

  await browser.close();
}

testLinkedInFeedSearch().catch(console.error);
