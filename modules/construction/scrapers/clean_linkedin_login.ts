import { chromium } from "playwright";
import * as path from "path";

async function loginClean() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  console.log("1. Cargando https://www.linkedin.com/login...");
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  console.log("2. Rellenando correo...");
  const emailLocator = page.locator("input[type='email']:visible, input#username:visible, input[name='session_key']:visible").first();
  await emailLocator.fill("miguesosagarcia@gmail.com");
  await page.waitForTimeout(400);

  console.log("3. Rellenando clave y pulsando Enter...");
  const passLocator = page.locator("input[type='password']:visible, input#password:visible, input[name='session_password']:visible").first();
  await passLocator.fill("Gianmarco00@");
  await page.waitForTimeout(400);

  await passLocator.press("Enter");

  console.log("4. Esperando respuesta tras login...");
  await page.waitForTimeout(7000);

  const currentUrl = page.url();
  console.log(`URL resultante: ${currentUrl}`);
  console.log(`Título: "${await page.title()}"`);

  const screenshotPath = path.join(__dirname, "../../../browser_profiles/linkedin_after_enter.png");
  await page.screenshot({ path: screenshotPath });
  console.log(`📸 Captura guardada en ${screenshotPath}`);

  const statePath = path.join(__dirname, "../../../browser_profiles/linkedin_state.json");
  await context.storageState({ path: statePath });
  console.log(`✅ Estado de sesión guardado en ${statePath}`);

  // Probar búsqueda directa de subcontratistas
  console.log("\n5. Probando búsqueda de subcontratistas en Louisville...");
  await page.goto("https://www.linkedin.com/search/results/content/?keywords=Louisville%20subcontractors", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const textSnippets = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("div.feed-shared-update-v2, div[data-urn], .search-results-container li, div.update-components-text"));
    return els.map(el => (el as HTMLElement).innerText.substring(0, 150)).filter(t => t.length > 20);
  });

  console.log(`Publicaciones de subcontratación encontradas en LinkedIn: ${textSnippets.length}`);
  if (textSnippets.length > 0) {
    console.log("Muestra:", textSnippets.slice(0, 3));
  }

  await browser.close();
}

loginClean().catch(console.error);
