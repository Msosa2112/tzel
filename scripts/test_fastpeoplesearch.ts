import { chromium } from "playwright";

async function testFastPeopleSearchAsync() {
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();
  const url = "https://www.fastpeoplesearch.com/address/808-brookline-ave_louisville-ky-40215";
  console.log(`🌐 Navegando a FastPeopleSearch: ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  console.log("⏳ Esperando 7 segundos a que cargue la lista de residentes y teléfonos...");
  await page.waitForTimeout(7000);

  const result = await page.evaluate(() => {
    const text = document.body.innerText;
    const phoneMatches = text.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/g) || [];
    const cleanPhones = Array.from(new Set(phoneMatches)).filter(p => 
      !p.includes("800-") && 
      !p.includes("888-") && 
      !p.includes("555-") &&
      !p.includes("877-")
    );

    const people = Array.from(document.querySelectorAll(".card, .person-card, .search-item, h2, h3")).map(el => el.textContent?.trim()).filter(Boolean);

    return {
      title: document.title,
      cleanPhones,
      people: people.slice(0, 10),
      snippet: text.substring(0, 600).replace(/\s+/g, " ")
    };
  });

  console.log("\n=============================================================");
  console.log("🎉 TELÉFONOS ENCONTRADOS EN FASTPEOPLESEARCH:");
  console.log(result.cleanPhones);
  console.log("Personas:", result.people);
  console.log("=============================================================\n");

  await browser.close();
}

testFastPeopleSearchAsync().catch(console.error);
