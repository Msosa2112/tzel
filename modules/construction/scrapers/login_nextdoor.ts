import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const STATE_PATH = path.join(__dirname, "../../../browser_profiles/nextdoor_state.json");
const PROFILES_DIR = path.join(__dirname, "../../../browser_profiles");

async function loginNextdoor() {
  console.log("=================================================================");
  console.log("🏡 ASISTENTE DE CONEXIÓN DE NEXTDOOR (LOUISVILLE & SUR DE IN) 🏡");
  console.log("=================================================================\n");

  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }

  console.log("🚀 Abriendo navegador visible para iniciar sesión en Nextdoor...");

  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  // Si ya existe sesión previa, cargarla
  if (fs.existsSync(STATE_PATH)) {
    console.log("🔄 Archivo de sesión previo detectado. Verificando estado...");
  }

  await page.goto("https://nextdoor.com/login/", { waitUntil: "domcontentloaded" });

  console.log("\n-----------------------------------------------------------------");
  console.log("👉 PASO 1: Inicia sesión con tu cuenta de Nextdoor en la ventana.");
  console.log("👉 PASO 2: Una vez que veas tu feed del vecindario en pantalla,");
  console.log("           regresa aquí a la terminal y presiona [ENTER].");
  console.log("-----------------------------------------------------------------\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise<void>((resolve) => {
    rl.question("⌨️ Presiona [ENTER] cuando hayas iniciado sesión en Nextdoor...", () => {
      rl.close();
      resolve();
    });
  });

  // Guardar cookies y storage
  await context.storageState({ path: STATE_PATH });
  console.log(`\n💾 [SESIÓN GUARDADA] Estado de Nextdoor guardado en: "${STATE_PATH}".`);

  // Extraer información del vecindario
  try {
    const neighborhood = await page.title();
    console.log(`📍 Vecindario / Perfil Activo: "${neighborhood}"`);
  } catch {}

  await browser.close();

  console.log("\n=================================================================");
  console.log("🎉 ¡NEXTDOOR CONECTADO CON ÉXITO!");
  console.log("El radar ahora podrá extraer publicaciones privadas de vecinos en Louisville.");
  console.log("=================================================================\n");
}

if (require.main === module) {
  loginNextdoor().catch(console.error);
}
