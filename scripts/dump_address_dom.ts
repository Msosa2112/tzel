import { chromium } from "playwright";
import * as path from "path";

async function dumpAddressDOM() {
  const PERSISTENT_DIR = path.join(__dirname, "../browser_profiles/chrome_user_session");
  const context = await chromium.launchPersistentContext(PERSISTENT_DIR, {
    headless: true,
    channel: "chrome"
  });

  const page = await context.newPage();
  const url = "https://www.truepeoplesearch.com/results?streetaddress=808+BROOKLINE+AVE&citystatezip=Louisville%2C+KY";
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const domInfo = await page.evaluate(() => {
    const allLinks = Array.from(document.querySelectorAll("a")).map(a => ({
      text: a.innerText.trim(),
      href: a.getAttribute("href"),
      dataDetail: a.getAttribute("data-detail-link"),
      className: a.className
    }));

    const cardElements = Array.from(document.querySelectorAll("[data-detail-link], .card, .card-summary, div.row")).map(el => ({
      tag: el.tagName,
      className: el.className,
      attrs: el.getAttributeNames().map(n => `${n}="${el.getAttribute(n)}"`).join(" "),
      textSnippet: el.textContent?.substring(0, 150).replace(/\s+/g, " ")
    }));

    return {
      title: document.title,
      links: allLinks.filter(l => l.href && !l.href.includes("javascript") && !l.href.includes("#")),
      cards: cardElements.slice(0, 8)
    };
  });

  console.log("DOM Info:", JSON.stringify(domInfo, null, 2));

  await context.close();
}

dumpAddressDOM().catch(console.error);
