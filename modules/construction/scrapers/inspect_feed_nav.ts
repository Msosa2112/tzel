import { chromium } from "playwright";
import * as path from "path";

async function inspectFeedNav() {
  const statePath = path.join(__dirname, "../../../browser_profiles/linkedin_state.json");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  const headerHtml = await page.evaluate(() => {
    const nav = document.querySelector("header, nav, #global-nav, .global-nav");
    return nav ? nav.innerHTML.substring(0, 1000) : "No header found";
  });

  console.log("Header HTML:\n", headerHtml);
  await browser.close();
}

inspectFeedNav().catch(console.error);
