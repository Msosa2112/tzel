import { chromium } from "playwright";
import * as path from "path";

async function loginToLinkedInProper() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  console.log("Accediendo a LinkedIn Login...");
  await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(2000);

  const emailField = await page.$("#username, #session_key, input[type='email'], input[name='session_key']");
  const passField = await page.$("#password, #session_password, input[type='password'], input[name='session_password']");

  if (emailField && passField) {
    console.log("Rellenando credenciales...");
    await emailField.fill("miguesosagarcia@gmail.com");
    await page.waitForTimeout(500);
    await passField.fill("Gianmarco00@");
    await page.waitForTimeout(500);

    console.log("Enviando formulario de login...");
    const submitBtn = await page.$("button[type='submit'], input[type='submit'], .btn__primary--large");
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    await page.waitForTimeout(6000);
  }

  console.log("URL actual:", page.url());
  console.log("Título:", await page.title());

  const statePath = path.join(__dirname, "../../../browser_profiles/linkedin_state.json");
  await context.storageState({ path: statePath });
  console.log(`Estado guardado en ${statePath}`);

  const screenshotPath = path.join(__dirname, "../../../browser_profiles/linkedin_after_login.png");
  await page.screenshot({ path: screenshotPath });
  console.log(`Captura tomada en ${screenshotPath}`);

  await browser.close();
}

loginToLinkedInProper().catch(console.error);
