import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

async function testCDP() {
  const profileDir = path.join(__dirname, "../browser_profiles/cdp_profile");
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  console.log("🚀 Lanzando navegador con perfil real para conexión directa...");
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome", // Usar Google Chrome real instalado en Windows
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--no-default-browser-check"
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();
  const url = "https://www.truepeoplesearch.com/results?streetaddress=808+BROOKLINE+AVE&citystatezip=Louisville%2C+KY";
  console.log(`🌐 Navegando en Chrome real a: ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);

  const title = await page.title();
  console.log(`📄 Título de Página: ${title}`);

  const pageInfo = await page.evaluate(() => {
    const isCaptcha = document.title.toLowerCase().includes("captcha");
    const cards = Array.from(document.querySelectorAll(".card, .card-summary"));
    const residents: string[] = [];

    cards.forEach(c => {
      const h4 = c.querySelector(".h4, .name, a");
      if (h4 && (h4 as HTMLElement).innerText && !(h4 as HTMLElement).innerText.includes("View Details")) {
        residents.push((h4 as HTMLElement).innerText.trim());
      }
    });

    return {
      isCaptcha,
      residentCount: cards.length,
      residents: residents.slice(0, 5)
    };
  });

  console.log("📊 Resultados:", JSON.stringify(pageInfo, null, 2));

  await browser.close();
}

testCDP().catch(console.error);
