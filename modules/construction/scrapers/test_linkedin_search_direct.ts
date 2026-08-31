import { chromium } from "playwright";
import * as path from "path";

async function testLinkedInSearchDirect() {
  const statePath = path.join(__dirname, "../../../browser_profiles/linkedin_state.json");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  const query = "Louisville subcontractors";
  const url = `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(query)}`;
  
  console.log(`Navegando a: ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);

  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(1000);
  }

  const pageText = await page.innerText("body");
  console.log("=== TEXTO DE LA PÁGINA ===");
  console.log(pageText.substring(0, 1000));
  console.log("==========================");

  await browser.close();
}

testLinkedInSearchDirect().catch(console.error);
