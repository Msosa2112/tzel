import { chromium } from "playwright";

async function testNewReddit() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });

  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });

  const searchUrl = "https://www.reddit.com/r/Louisville/search/?q=recommend+contractor+OR+roofer+OR+deck+OR+concrete&restrict_sr=1&sort=new";
  console.log("Navigating to:", searchUrl);

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(4000);

  const posts = await page.$$eval("shreddit-post, a[data-testid='post-title']", (nodes) => {
    return nodes.map((n) => {
      if (n.tagName.toLowerCase() === "shreddit-post") {
        return {
          title: n.getAttribute("post-title") || "",
          author: n.getAttribute("author") || "",
          permalink: n.getAttribute("permalink") || "",
          score: n.getAttribute("score") || ""
        };
      } else {
        return {
          title: (n as HTMLElement).innerText.trim(),
          author: "",
          permalink: (n as HTMLAnchorElement).href,
          score: ""
        };
      }
    });
  });

  console.log(`Found ${posts.length} posts on modern Reddit!`);
  posts.slice(0, 10).forEach((p, idx) => {
    console.log(`[${idx + 1}] "${p.title}" | Author: u/${p.author} | Link: https://reddit.com${p.permalink}`);
  });

  await browser.close();
}

testNewReddit().catch(console.error);
