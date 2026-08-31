import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

async function discoverJoinedGroups() {
  const statePath = path.join(__dirname, "../../../browser_profiles/facebook_state.json");
  if (!fs.existsSync(statePath)) {
    console.error("No se encontró facebook_state.json");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  console.log("Navegando a https://www.facebook.com/groups/joins/ para listar tus grupos...");
  await page.goto("https://www.facebook.com/groups/joins/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);

  for (let s = 0; s < 5; s++) {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(1000);
  }

  const groups = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a[href*='/groups/']"));
    const map = new Map<string, string>();

    anchors.forEach(a => {
      const href = (a as HTMLAnchorElement).href;
      const text = (a as HTMLElement).innerText.trim();

      // Excluir enlaces del menú general
      if (
        href.includes("/groups/feed") ||
        href.includes("/groups/discover") ||
        href.includes("/groups/create") ||
        href.includes("/groups/joins") ||
        href.includes("/groups/categories") ||
        text.length < 3 ||
        text.includes("Grupos") ||
        text.includes("Descubrir")
      ) {
        return;
      }

      // Limpiar URL del grupo
      const match = href.match(/https:\/\/(www\.)?facebook\.com\/groups\/[^/?#]+/);
      if (match) {
        const cleanUrl = match[0];
        if (!map.has(cleanUrl) && text.length > 3) {
          map.set(cleanUrl, text.split("\n")[0]);
        }
      }
    });

    return Array.from(map.entries()).map(([url, name]) => ({ name, url }));
  });

  console.log(`\n🎉 Total de grupos detectados en tu cuenta: ${groups.length}`);
  console.log(JSON.stringify(groups.slice(0, 25), null, 2));

  const outputPath = path.join(__dirname, "../../../browser_profiles/discovered_facebook_groups.json");
  fs.writeFileSync(outputPath, JSON.stringify(groups, null, 2), "utf-8");
  console.log(`\n📁 Lista guardada en ${outputPath}`);

  await browser.close();
}

discoverJoinedGroups().catch(console.error);
