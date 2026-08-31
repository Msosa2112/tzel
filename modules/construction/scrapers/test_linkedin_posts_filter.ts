import { chromium } from "playwright";
import * as path from "path";

async function testLinkedInPostsFilter() {
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
  await page.waitForTimeout(4000);

  console.log("Haciendo clic en 'Publicaciones'...");
  const postBtn = page.locator("button:has-text('Publicaciones'), a:has-text('Publicaciones'), button:has-text('Posts')").first();
  await postBtn.click();
  await page.waitForTimeout(5000);

  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(1000);
  }

  const postsText = await page.innerText("body");
  console.log("=== PUBLICACIONES ENCONTRADAS ===");
  console.log(postsText.substring(0, 1500));
  console.log("================================");

  const screenshotPath = path.join(__dirname, "../../../browser_profiles/linkedin_posts_view.png");
  await page.screenshot({ path: screenshotPath });
  console.log(`📸 Captura guardada en ${screenshotPath}`);

  await browser.close();
}

testLinkedInPostsFilter().catch(console.error);
