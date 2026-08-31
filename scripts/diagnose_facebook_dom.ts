import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

async function diagnose() {
  const statePath = path.join(__dirname, "../browser_profiles/facebook_state.json");
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();
  const testUrl = "https://www.facebook.com/groups/1615079142072651"; // Main feed of group
  console.log("Navigating to:", testUrl);
  await page.goto(testUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  const screenshotPath = path.join(__dirname, "../browser_profiles/facebook_debug.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log("Saved debug screenshot to:", screenshotPath);

  const text = await page.evaluate(() => document.body.innerText);
  console.log("Main group page text sample:", text.slice(0, 500).replace(/\n+/g, " "));

  await browser.close();
}

diagnose().catch(console.error);
