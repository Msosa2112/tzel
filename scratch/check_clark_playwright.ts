import { chromium } from "playwright";

async function runCheck() {
  console.log("Abriendo Clark County Sheriff Sales con Playwright...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto("https://www.clarkcosheriff.com/sheriff-sales/", { waitUntil: "networkidle", timeout: 20000 });
    const title = await page.title();
    console.log("Título de la página:", title);
    
    // Obtener todo el texto de la página
    const bodyText = await page.innerText("body");
    
    // Buscar la palabra "vs" o "vs." en el texto de la página
    const lines = bodyText.split("\n");
    console.log(`Total líneas de texto: ${lines.length}`);
    
    console.log("\nBuscando 'vs' en las líneas de texto:");
    let foundCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.toLowerCase().includes(" vs ") || line.toLowerCase().includes(" vs.") || line.toLowerCase().includes(" versus ")) {
        console.log(`Línea ${i}: "${line}"`);
        foundCount++;
      }
    }
    console.log(`Encontradas ${foundCount} líneas con 'vs'.`);
    
    // Imprimir las líneas alrededor de "SHERIFF SALES 2026"
    console.log("\nLíneas alrededor de 'SHERIFF SALES 2026':");
    let startIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("SHERIFF SALES 2026")) {
        startIdx = i;
        break;
      }
    }
    
    if (startIdx !== -1) {
      for (let i = startIdx; i < Math.min(lines.length, startIdx + 100); i++) {
        const line = lines[i].trim();
        if (line) {
          console.log(`${i}: "${line}"`);
        }
      }
    } else {
      console.log("No se encontró 'SHERIFF SALES 2026'");
    }
    
  } catch (e: any) {
    console.error("Error:", e.message);
  } finally {
    await browser.close();
  }
}

runCheck();
