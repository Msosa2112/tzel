import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";

const STATE_PATH = path.join(__dirname, "../../../browser_profiles/facebook_state.json");
const PROFILES_DIR = path.join(__dirname, "../../../browser_profiles");

async function loginUserFacebook() {
  console.log("=================================================================");
  console.log("👤 ASISTENTE DE CONEXIÓN DE TU CUENTA DE FACEBOOK (MIGUEL SOSA) 👤");
  console.log("=================================================================\n");

  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }

  console.log("🚀 Abriendo navegador visible para conectar tu cuenta...");

  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const context = await browser.newContext({
    storageState: fs.existsSync(STATE_PATH) ? STATE_PATH : undefined,
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();
  await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });

  console.log("\n-----------------------------------------------------------------");
  console.log("👉 PASO 1: Haz clic en tu perfil (Miguel Sosa) o inicia sesión.");
  console.log("👉 PASO 2: Una vez que veas tu muro principal de Facebook,");
  console.log("           regresa aquí a la terminal y presiona [ENTER].");
  console.log("-----------------------------------------------------------------\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise<void>((resolve) => {
    rl.question("⌨️ Presiona [ENTER] cuando estés dentro de tu muro de Facebook...", () => {
      rl.close();
      resolve();
    });
  });

  // Guardar cookies y storage para siempre
  await context.storageState({ path: STATE_PATH });
  console.log(`\n💾 [SESIÓN GUARDADA] Estado de Facebook guardado en: "${STATE_PATH}".`);

  await browser.close();

  console.log("\n=================================================================");
  console.log("🎉 ¡TU CUENTA DE FACEBOOK QUEDÓ CONECTADA CON ÉXITO!");
  console.log("El radar ahora podrá extraer publicaciones de los 55+ grupos comunitarios.");
  console.log("=================================================================\n");
}

if (require.main === module) {
  loginUserFacebook().catch(console.error);
}
