import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

async function checkFbSession() {
  const statePath = path.join(__dirname, "../browser_profiles/facebook_state.json");
  if (!fs.existsSync(statePath)) {
    console.log("❌ No existe facebook_state.json");
    return;
  }

  console.log("🔍 Verificando sesión activa de Facebook...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();
  await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(4000);

  const currentUrl = page.url();
  const pageTitle = await page.title();
  const isLoginPage = currentUrl.includes("/login") || currentUrl.includes("/checkpoint") || (await page.$('input[name="email"]')) !== null;
  const isFeed = (await page.$('div[role="feed"]')) !== null || (await page.$('div[role="main"]')) !== null || (await page.$('div[aria-label="Facebook"]')) !== null || currentUrl.includes("facebook.com");

  await page.screenshot({ path: path.join(__dirname, "../browser_profiles/fb_session_live_check.png") });

  console.log(`URL Actual: ${currentUrl}`);
  console.log(`Título de Página: ${pageTitle}`);
  console.log(`¿Requiere Login?: ${isLoginPage}`);
  console.log(`¿Muro / Sesión detectada?: ${isFeed}`);

  await browser.close();
}

checkFbSession().catch(console.error);
