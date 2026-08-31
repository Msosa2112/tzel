import { chromium } from "playwright";
import * as path from "path";

async function debugGroupFeed() {
  const statePath = path.join(__dirname, "../../../browser_profiles/facebook_state.json");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  const url = "https://www.facebook.com/groups/cubanosenlouisville/?sorting_setting=CHRONOLOGICAL";
  console.log(`Navegando a: ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);

  for (let s = 1; s <= 6; s++) {
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1200);
  }

  const rawText = await page.innerText("body");
  console.log("=== PRIMEROS 2500 CARACTERES DEL GRUPO ===");
  console.log(rawText.substring(0, 2500));
  console.log("=========================================");

  await browser.close();
}

debugGroupFeed().catch(console.error);
