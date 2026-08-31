import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";

const PERSISTENT_DIR = path.join(__dirname, "../../../browser_profiles/chrome_user_session");

async function runDirectPersistentLogin() {
  console.log("=================================================================");
  console.log("🔓 SESIÓN PERSISTENTE DE CHROME (NO INCÓGNITO / COOKIES REALES) 🔓");
  console.log("=================================================================\n");

  if (!fs.existsSync(PERSISTENT_DIR)) {
    fs.mkdirSync(PERSISTENT_DIR, { recursive: true });
  }

  console.log("🚀 Abriendo Google Chrome con tu perfil persistente en disco...");

  // Iniciar contexto persistente (guarda todo: cookies, logins, historial, Google)
  const context = await chromium.launchPersistentContext(PERSISTENT_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1280, height: 800 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  const testUrl = "https://www.truepeoplesearch.com/results?streetaddress=808+BROOKLINE+AVE&citystatezip=Louisville%2C+KY";

  console.log(`🌐 Navegando a TruePeopleSearch: ${testUrl}\n`);
  
  try {
    await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (e: any) {
    console.log("Página cargando...");
  }

  console.log("-----------------------------------------------------------------");
  console.log("👉 Si ves la casilla de Cloudflare ('No soy un robot'), márcala.");
  console.log("👉 Cuando veas los resultados de la dirección en la pantalla del navegador,");
  console.log("   presiona [ENTER] aquí en esta consola.");
  console.log("-----------------------------------------------------------------\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise<void>((resolve) => {
    rl.question("⌨️ Presiona [ENTER] para guardar y cerrar...", () => {
      rl.close();
      resolve();
    });
  });

  console.log("\n💾 Guardando estado y cookies de sesión permanente...");
  await context.close();

  console.log("\n=================================================================");
  console.log("🎉 ¡SESIÓN GUARDADA PERMANENTEMENTE EN DISCO!");
  console.log("=================================================================\n");
}

runDirectPersistentLogin().catch(console.error);
