import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import * as path from "path";

chromium.use(stealthPlugin());

async function testNameSearch() {
  const userDataDir = path.join(__dirname, "../browser_profiles/skiptrace_profile");
  
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  // Test 1: Buscar por dirección en TPS
  const addrUrl = "https://www.truepeoplesearch.com/results?streetaddress=808+BROOKLINE+AVE&citystatezip=Louisville%2C+KY";
  console.log(`🌐 Navegando a: ${addrUrl}`);
  await page.goto(addrUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(3000);

  // Extraer el nombre del primer residente
  const residents = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".card, .card-summary"));
    return cards.map(c => {
      const name = (c.querySelector(".h4, .name") as HTMLElement)?.innerText.trim();
      const age = (c.querySelector(".age, .content-value") as HTMLElement)?.innerText.trim();
      return { name, age };
    }).filter(r => r.name);
  });

  console.log("👥 Residentes encontrados en la dirección:", residents);

  if (residents.length > 0) {
    const targetName = residents[0].name;
    console.log(`🔎 Buscando teléfonos para: ${targetName} en Louisville, KY`);
    const nameUrl = `https://www.truepeoplesearch.com/results?name=${encodeURIComponent(targetName)}&citystatezip=Louisville%2C+KY`;
    await page.goto(nameUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(3000);

    const phonesFound = await page.evaluate(() => {
      const phones: string[] = [];
      const links = Array.from(document.querySelectorAll("a[href*='/find/phone/'], span[itemprop='telephone']"));
      links.forEach(l => {
        const t = (l as HTMLElement).innerText.trim();
        if (t && !phones.includes(t)) phones.push(t);
      });
      return {
        count: links.length,
        phones,
        pageText: document.body.innerText.substring(0, 800)
      };
    });

    console.log("📞 Teléfonos encontrados en búsqueda por nombre:", phonesFound);
  }

  await context.close();
}

testNameSearch();
