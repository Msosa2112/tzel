import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";

const rawCookies = [
  {
    "domain": ".facebook.com",
    "expirationDate": 1821435067.481998,
    "hostOnly": false,
    "httpOnly": true,
    "name": "ps_l",
    "path": "/",
    "sameSite": "lax",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "1"
  },
  {
    "domain": ".facebook.com",
    "expirationDate": 1820856800.208224,
    "hostOnly": false,
    "httpOnly": true,
    "name": "datr",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "3rl4alHhi80OPqCDMdAnJ8yM"
  },
  {
    "domain": ".facebook.com",
    "expirationDate": 1794651121.705489,
    "hostOnly": false,
    "httpOnly": true,
    "name": "fr",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "1sshItdry51Y3jx5H.AWcYHrYw-60koN9c3UFmoNEfZLoO7jZ_AYhGVS7zBnq26GXK_dg.BqgYzx..AAA.0.0.BqgYzx.AWf4kzmdNyM_iKmryUnEpPB3Pnc"
  },
  {
    "domain": ".facebook.com",
    "expirationDate": 1818411121.705526,
    "hostOnly": false,
    "httpOnly": true,
    "name": "xs",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "38%3AKhl5zKzVICESIg%3A2%3A1786875117%3A-1%3A-1%3A%3AAcycJQ4_WWbRIFZ0WtWgS9OKFzQgQOzJnVVPWxMeTg"
  },
  {
    "domain": ".facebook.com",
    "expirationDate": 1787479909.94582,
    "hostOnly": false,
    "httpOnly": false,
    "name": "locale",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "es_LA"
  },
  {
    "domain": ".facebook.com",
    "expirationDate": 1818411121.705383,
    "hostOnly": false,
    "httpOnly": false,
    "name": "c_user",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "100086004853370"
  },
  {
    "domain": ".facebook.com",
    "hostOnly": false,
    "httpOnly": false,
    "name": "presence",
    "path": "/",
    "sameSite": null,
    "secure": true,
    "session": true,
    "storeId": null,
    "value": "C%7B%22t3%22%3A%5B%5D%2C%22utc3%22%3A1786875124048%2C%22v%22%3A1%7D"
  },
  {
    "domain": ".facebook.com",
    "expirationDate": 1787479923,
    "hostOnly": false,
    "httpOnly": false,
    "name": "dpr",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "1.5"
  },
  {
    "domain": ".facebook.com",
    "expirationDate": 1821435067.482125,
    "hostOnly": false,
    "httpOnly": true,
    "name": "ps_n",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "1"
  },
  {
    "domain": ".facebook.com",
    "expirationDate": 1821435119.628009,
    "hostOnly": false,
    "httpOnly": true,
    "name": "sb",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "3rl4an4MFNVhDbQNbvnjvKjm"
  },
  {
    "domain": ".facebook.com",
    "expirationDate": 1787480559,
    "hostOnly": false,
    "httpOnly": false,
    "name": "wd",
    "path": "/",
    "sameSite": "lax",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "1280x631"
  }
];

async function setupAndVerifySession() {
  const profileDir = path.join(__dirname, "../../../browser_profiles");
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  const statePath = path.join(profileDir, "facebook_state.json");

  // Mapear al formato oficial de Playwright StorageState
  const playwrightCookies = rawCookies.map(c => {
    let sameSite: "Strict" | "Lax" | "None" = "None";
    if (c.sameSite === "lax") sameSite = "Lax";
    else if (c.sameSite === "strict") sameSite = "Strict";
    else if (c.sameSite === "no_restriction") sameSite = "None";

    return {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expirationDate || -1,
      httpOnly: c.httpOnly || false,
      secure: c.secure || false,
      sameSite
    };
  });

  const storageState = {
    cookies: playwrightCookies,
    origins: [
      {
        origin: "https://www.facebook.com",
        localStorage: []
      }
    ]
  };

  fs.writeFileSync(statePath, JSON.stringify(storageState, null, 2), "utf-8");
  console.log(`✅ Archivo '${statePath}' creado con éxito.`);

  // Verificar la sesión navegando con Playwright
  console.log("\n🔍 Verificando sesión con Playwright headless...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(4000);

  const url = page.url();
  const title = await page.title();
  console.log(`URL detectada: ${url}`);
  console.log(`Título de la página: ${title}`);

  const cookies = await context.cookies();
  const hasUser = cookies.some(c => c.name === "c_user");

  if (hasUser && !url.includes("login") && !url.includes("checkpoint")) {
    console.log("🎉 ¡AUTENTICACIÓN VERIFICADA AL 100%! La sesión de Facebook está activa y lista para scrapers.");
  } else {
    console.log("⚠️ Verificación pendiente o redirección detectada.");
  }

  const ssPath = path.join(profileDir, "fb_verified_screen.png");
  await page.screenshot({ path: ssPath });
  console.log(`Captura de pantalla de verificación: ${ssPath}`);

  await browser.close();
}

setupAndVerifySession().catch(console.error);
