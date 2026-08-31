import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";

const BARBA_PROFILE_DIR = path.resolve(__dirname, "../../../browser_profiles/barba_facebook_session");
const BARBA_STATE_FILE = path.resolve(__dirname, "../../../browser_profiles/barba_facebook_state.json");
const BARBA_GROUPS_FILE = path.resolve(__dirname, "../../../browser_profiles/barba_discovered_groups.json");

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve =>
    rl.question(query, ans => {
      rl.close();
      resolve(ans);
    })
  );
}

/**
 * Lanzador visual para conectar e iniciar sesión con la cuenta de Facebook de Barba
 */
async function loginBarbaFacebook() {
  console.log("\n=================================================================");
  console.log("🔵 VINCULACIÓN DE CUENTA DE FACEBOOK DE BARBA CONSTRUCTION 🔵");
  console.log("=================================================================\n");
  console.log("1. Se abrirá una ventana de Chrome visible en tu pantalla.");
  console.log("2. Ingresa el teléfono/correo de Barba y aprueba el inicio de sesión vía SMS, WhatsApp o notificación en su teléfono.");
  console.log("3. Una vez que estés dentro de Facebook (en el feed principal), regresa a esta terminal y presiona ENTER.");
  console.log("-----------------------------------------------------------------\n");

  if (!fs.existsSync(BARBA_PROFILE_DIR)) {
    fs.mkdirSync(BARBA_PROFILE_DIR, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(BARBA_PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 850 },
    locale: "es-ES",
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  console.log("🌐 Navegando a Facebook...");
  await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });

  await askQuestion("\n👉 Cuando hayas iniciado sesión en la ventana de Facebook, presiona [ENTER] aquí para guardar la sesión...");

  console.log("\n💾 Verificando y extrayendo sesión de Barba...");
  await page.waitForTimeout(3000);

  // Guardar estado y cookies
  await context.storageState({ path: BARBA_STATE_FILE });
  console.log(`✅ [SESIÓN GUARDADA] Archivo de estado: ${BARBA_STATE_FILE}`);

  // Descubrir automáticamente todos los grupos en los que está Barba
  console.log("\n🔍 Escaneando todos los grupos comunitarios y de construcción de Barba...");
  try {
    await page.goto("https://www.facebook.com/groups/joins/", { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(3500);

    // Scroll para cargar todos los grupos
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(1000);
    }

    const groups = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
      const groupMap = new Map();

      links.forEach(a => {
        const href = (a as HTMLAnchorElement).href;
        const text = (a as HTMLElement).innerText?.trim();
        const match = href.match(/facebook\.com\/groups\/([^\/\?]+)/);

        if (match && text && text.length > 2 && !text.toLowerCase().includes("unirte") && !text.toLowerCase().includes("crear")) {
          const groupId = match[1];
          if (!groupMap.has(groupId) && groupId !== "feed" && groupId !== "discover" && groupId !== "joins") {
            groupMap.set(groupId, {
              id: groupId,
              name: text.split("\n")[0].trim(),
              url: `https://www.facebook.com/groups/${groupId}`
            });
          }
        }
      });

      return Array.from(groupMap.values());
    });

    console.log(`🎉 ¡ÉXITO! Se descubrieron ${groups.length} grupos en la cuenta de Barba.`);
    fs.writeFileSync(BARBA_GROUPS_FILE, JSON.stringify(groups, null, 2), "utf-8");
    console.log(`📁 Lista de grupos guardada en: ${BARBA_GROUPS_FILE}`);
  } catch (err: any) {
    console.warn(`⚠️ No se pudieron listar los grupos automáticamente: ${err.message}`);
  }

  await context.close();
  console.log("\n=================================================================");
  console.log("🚀 CUENTA DE BARBA VINCULADA Y LISTA PARA EL RADAR AUTOMÁTICO");
  console.log("=================================================================\n");
}

if (require.main === module) {
  loginBarbaFacebook().catch(console.error);
}

export { loginBarbaFacebook };
