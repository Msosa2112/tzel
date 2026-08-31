import { chromium } from "playwright";
import * as path from "path";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: path.resolve(process.cwd(), "browser_profiles/facebook_state.json"),
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  const searchUrl = "https://www.facebook.com/search/posts/?q=Louisville%20recommend%20contractor";
  console.log("Navigating to:", searchUrl);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(4000);

  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1200);
  }

  const posts = await page.evaluate(() => {
    const main = document.querySelector('div[role="main"]') || document.body;
    // Find all article or feed items in search
    const candidates = Array.from(main.querySelectorAll('div[role="feed"] > div, div[role="article"], div.x1yztbdb, div.x1n2onr6'));
    const results: any[] = [];
    const seen = new Set<string>();

    for (const el of candidates) {
      if (el.closest('div[role="navigation"]') || el.closest('div[role="banner"]')) continue;
      const text = (el as HTMLElement).innerText?.trim() || "";
      if (text.length < 50 || text.length > 3500) continue;
      if (text.includes("chats no leídos") || text.includes("Falta el historial")) continue;

      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const hashKey = text.slice(0, 80);
      if (seen.has(hashKey)) continue;
      seen.add(hashKey);

      const links = Array.from(el.querySelectorAll("a")).map(a => a.href);
      const postLink = links.find(l => l.includes("/posts/") || l.includes("/permalink/") || l.includes("story_fbid") || l.includes("groups/")) || "";

      results.push({
        author: lines[0] || "Usuario de Facebook",
        text: text,
        postLink,
        lines: lines.slice(0, 6)
      });
    }
    return results;
  });

  console.log(`\nFiltered Search Posts Count: ${posts.length}`);
  posts.slice(0, 8).forEach((p, idx) => {
    console.log(`\n=== POST #${idx+1} ===`);
    console.log(`Author: ${p.author}`);
    console.log(`Link: ${p.postLink}`);
    console.log(`Text: ${p.text.substring(0, 200)}...`);
  });

  await browser.close();
}

main().catch(console.error);
