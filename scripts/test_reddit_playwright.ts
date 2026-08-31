import { chromium } from "playwright";

async function testReddit() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });

  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });

  const queries = ["contractor", "roofer", "roof", "deck", "concrete", "siding", "fence", "remodel"];
  console.log("Searching old.reddit.com/r/Louisville...");

  for (const q of queries) {
    const url = `https://old.reddit.com/r/Louisville/search?q=${encodeURIComponent(q)}&restrict_sr=on&sort=new&t=all`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2000);

    const posts = await page.$$eval(".search-result", (nodes) => {
      return nodes.map((n) => {
        const titleEl = n.querySelector(".search-title") as HTMLElement;
        const authorEl = n.querySelector(".author") as HTMLElement;
        const timeEl = n.querySelector("time") as HTMLElement;
        const snippetEl = n.querySelector(".search-result-body") as HTMLElement;

        const a = titleEl ? titleEl.querySelector("a") : null;
        return {
          title: a ? a.innerText.trim() : "",
          url: a ? a.href : "",
          author: authorEl ? authorEl.innerText.trim() : "",
          date: timeEl ? timeEl.getAttribute("datetime") : "",
          snippet: snippetEl ? snippetEl.innerText.trim() : ""
        };
      });
    });

    console.log(`\n🔎 Query: "${q}" -> Found ${posts.length} posts.`);
    posts.slice(0, 3).forEach((p, idx) => {
      console.log(`   [${idx + 1}] "${p.title}" by u/${p.author} (${p.date?.slice(0, 10)})`);
      console.log(`       🔗 Link: ${p.url}`);
    });
  }

  await browser.close();
}

testReddit().catch(console.error);
