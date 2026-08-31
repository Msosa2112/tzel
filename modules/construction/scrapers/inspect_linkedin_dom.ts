import { chromium } from "playwright";
import * as path from "path";

async function inspectLinkedInSearch() {
  const statePath = path.join(__dirname, "../../../browser_profiles/linkedin_state.json");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  const query = "Louisville subcontractors";
  const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`;
  
  console.log(`Navegando a: ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(6000);

  const screenshotPath = path.join(__dirname, "../../../browser_profiles/linkedin_search_preview.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`📸 Captura guardada en ${screenshotPath}`);

  const pageInfo = await page.evaluate(() => {
    const title = document.title;
    const bodySnippet = document.body.innerText.substring(0, 500);
    const classes = Array.from(new Set(Array.from(document.querySelectorAll("*")).map(el => el.className).filter(c => typeof c === "string" && c.includes("search")))).slice(0, 15);
    const allDivs = document.querySelectorAll("div").length;
    const allArticles = document.querySelectorAll("article, [role='article'], .feed-shared-update-v2").length;
    return { title, bodySnippet, classes, allDivs, allArticles };
  });

  console.log("Información del DOM:", pageInfo);
  await browser.close();
}

inspectLinkedInSearch().catch(console.error);
