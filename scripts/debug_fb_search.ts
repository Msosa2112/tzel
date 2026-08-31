import { chromium } from "playwright";
import * as path from "path";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

async function debugFacebookSearch() {
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

  for (let s = 1; s <= 4; s++) {
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1200);
  }

  const postsData = await page.evaluate(() => {
    const main = document.querySelector('div[role="main"]') || document.body;
    // Find all article or feed items in search
    const candidates = Array.from(main.querySelectorAll('div[role="feed"] > div, div[role="article"], div.x1yztbdb, div.x1n2onr6'));
    const results: any[] = [];

    for (const el of candidates) {
      if (el.closest('div[role="navigation"]') || el.closest('div[role="banner"]')) continue;
      const text = (el as HTMLElement).innerText?.trim() || "";
      if (text.length < 30 || text.length > 3500) continue;
      if (text.includes("chats no leídos") || text.includes("Falta el historial")) continue;

      const links = Array.from(el.querySelectorAll("a")).map(a => a.href);
      const postLink = links.find(l => l.includes("/posts/") || l.includes("/permalink/") || l.includes("story_fbid") || l.includes("/groups/")) || "";
      const userLink = links.find(l => l.includes("facebook.com/") && !l.includes("/search/") && !l.includes("/groups/")) || "";
      const authorEl = el.querySelector('strong, h3, h2, a[role="link"]');
      const author = authorEl ? (authorEl as HTMLElement).innerText.trim() : "Vecino";

      results.push({ author, text, postLink, userLink });
    }
    return results;
  });

  console.log(`Evaluated ${postsData.length} raw post blocks.`);
  for (let i = 0; i < postsData.length; i++) {
    const p = postsData[i];
    console.log(`\n--- CANDIDATE #${i+1} ---`);
    console.log("Author:", p.author);
    console.log("Link:", p.postLink);
    console.log("Text:", p.text.substring(0, 200));

    if (GEMINI_API_KEY && p.text.length > 40) {
      const prompt = `Analiza si este post es un propietario/cliente buscando servicios de construccion/remodelacion/techos/siding/concreto/porches o un contratista ofreciendo trabajo:
"""${p.text.slice(0, 600)}"""
Responde en JSON: {"isHomeownerLookingForWork": boolean, "serviceCategory": string, "summary": string, "estimatedBudget": number}`;

      try {
        const res = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
          },
          { timeout: 8000 }
        );
        const json = JSON.parse(res.data?.candidates?.[0]?.content?.parts?.[0]?.text);
        console.log("GEMINI AUDIT:", JSON.stringify(json));
      } catch (err: any) {
        console.log("Gemini Err:", err.message);
      }
    }
  }

  await browser.close();
}

debugFacebookSearch().catch(console.error);
