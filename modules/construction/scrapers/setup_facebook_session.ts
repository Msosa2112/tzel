import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

/**
 * Script interactivo para iniciar sesión en Facebook por única vez.
 * Guarda la sesión (cookies y tokens) en 'browser_profiles/facebook_session'
 * para que todos los scrapers puedan entrar a grupos y búsquedas en segundo plano.
 */
async function setupFacebookSession() {
  const userDir = path.join(__dirname, "../../../browser_profiles/facebook_session");
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }

  console.log("=================================================================");
  console.log("🌐 ABRIENDO NAVEGADOR VISIBLE PARA INICIAR SESIÓN EN FACEBOOK 🌐");
  console.log("Por favor, introduce tu usuario, contraseña y código 2FA si lo pide.");
  console.log("Una vez que estés dentro de Facebook, la sesión se guardará sola.");
  console.log("=================================================================");

  const context = await chromium.launchPersistentContext(userDir, {
    headless: false, // Abre la ventana visible en tu pantalla
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"]
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });

  console.log("\n⏳ Esperando a que completes el inicio de sesión...");

  // Esperar hasta que el usuario haya iniciado sesión con éxito (comprobando cookies o URL)
  let loggedIn = false;
  for (let i = 0; i < 180; i++) { // Espera hasta 3 minutos
    await page.waitForTimeout(1000);
    const cookies = await context.cookies();
    const hasUserCookie = cookies.some(c => c.name === "c_user");
    const currentUrl = page.url();

    if (hasUserCookie || (!currentUrl.includes("login") && !currentUrl.includes("checkpoint") && !currentUrl.includes("recover") && currentUrl.includes("facebook.com"))) {
      if (hasUserCookie) {
        loggedIn = true;
        console.log("\n🎉 ¡Inicio de sesión detectado exitosamente en Facebook!");
        break;
      }
    }
  }

  if (loggedIn) {
    const statePath = path.join(__dirname, "../../../browser_profiles/facebook_state.json");
    await context.storageState({ path: statePath });
    console.log(`✅ Sesión guardada permanentemente en: ${statePath}`);
    console.log("Ahora el sistema podrá escanear grupos de Louisville en segundo plano.");
  } else {
    console.log("⚠️ Tiempo de espera agotado. Si aún no terminaste, vuelve a ejecutar el comando.");
  }

  await page.waitForTimeout(3000);
  await context.close();
}

setupFacebookSession().catch(console.error);
