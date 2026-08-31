import { chromium } from "playwright";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import axios from "axios";

async function testIndependentChromeCDP() {
  const profileDir = path.join(__dirname, "../browser_profiles/chrome_cdp_standalone");
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const chromeExe = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  console.log("🚀 Iniciando Chrome nativo desacoplado en puerto 9225...");

  const child = spawn(chromeExe, [
    "--remote-debugging-port=9225",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://www.google.com"
  ], {
    detached: true,
    stdio: "ignore"
  });

  child.unref();

  // Esperar a que el endpoint /json/version responda
  let ready = false;
  for (let i = 0; i < 15; i++) {
    try {
      const res = await axios.get("http://127.0.0.1:9225/json/version", { timeout: 1000 });
      if (res.status === 200) {
        console.log("✅ Chrome CDP Activo:", res.data.webSocketDebuggerUrl);
        ready = true;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 600));
  }

  if (!ready) {
    console.error("❌ No se pudo conectar con Chrome en puerto 9225");
    return;
  }

  console.log("🔗 Conectando Playwright vía CDP al navegador real...");
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9225");
  const context = browser.contexts()[0];
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  const url = "https://www.truepeoplesearch.com/results?streetaddress=808+BROOKLINE+AVE&citystatezip=Louisville%2C+KY";
  console.log(`🌐 Navegando a: ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(4000);

  const title = await page.title();
  console.log(`📄 TÍTULO DE PÁGINA OBTENIDO: "${title}"`);

  const result = await page.evaluate(() => {
    const isCaptcha = document.title.toLowerCase().includes("captcha");
    const cards = Array.from(document.querySelectorAll(".card, .card-summary"));
    const residents: string[] = [];

    cards.forEach(c => {
      const h4 = c.querySelector(".h4, .name, a");
      const name = h4 ? (h4 as HTMLElement).innerText.trim() : "";
      if (name && !name.includes("View Details")) {
        residents.push(name);
      }
    });

    return {
      isCaptcha,
      residentCount: cards.length,
      residents: residents.slice(0, 6),
      pageSnippet: document.body.innerText.substring(0, 400).replace(/\n+/g, " ")
    };
  });

  console.log("🎉 RESULTADO COMPLETO VÍA CDP REAL:", JSON.stringify(result, null, 2));

  await browser.close();
}

testIndependentChromeCDP().catch(console.error);
