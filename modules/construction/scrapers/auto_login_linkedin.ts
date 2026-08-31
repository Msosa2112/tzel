import { chromium } from "playwright";
import * as path from "path";

async function loginLinkedIn() {
  const statePath = path.join(__dirname, "../../../browser_profiles/linkedin_state.json");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  console.log("Navegando a LinkedIn Login...");
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const pwdInput = await page.$("input[type='password'], input#password");
  const usernameInput = await page.$("input#username, input[type='email']");

  if (usernameInput) {
    console.log("Rellenando usuario...");
    await usernameInput.fill("miguesosagarcia@gmail.com");
    await page.waitForTimeout(500);
  }

  if (pwdInput) {
    console.log("Rellenando contraseña...");
    await pwdInput.fill("Gianmarco00@");
    await page.waitForTimeout(1000);

    const submitBtn = await page.$("button[type='submit'], .btn__primary--large");
    if (submitBtn) {
      console.log("Haciendo clic en Iniciar sesión...");
      await submitBtn.click();
      await page.waitForTimeout(7000);
    }
  }

  console.log(`URL tras login: ${page.url()}`);
  console.log(`Título de la página: "${await page.title()}"`);

  // Guardar nuevo estado
  await context.storageState({ path: statePath });
  console.log(`✅ Nuevo storageState guardado en ${statePath}`);

  // Verificar búsqueda
  console.log("Probando búsqueda de subcontratistas en Louisville...");
  await page.goto("https://www.linkedin.com/search/results/content/?keywords=Louisville%20subcontractors", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const searchResultsCount = await page.evaluate(() => {
    return document.querySelectorAll("div.feed-shared-update-v2, div[data-urn*='urn:li:activity'], .search-results-container").length;
  });

  console.log(`📊 Elementos de resultados de búsqueda detectados: ${searchResultsCount}`);
  await browser.close();
}

loginLinkedIn().catch(console.error);
