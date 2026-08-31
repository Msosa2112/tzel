import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";

const rawCookies = [
  {
    "domain": ".linkedin.com",
    "expirationDate": 1789484421.326139,
    "hostOnly": false,
    "httpOnly": false,
    "name": "lms_ads",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "AQGLKwvuqwsTQgAAAaALFoKzifH0RoCf5fzH4M7b_7bT_KQdg_EUfVMcQAk2XQperlaCPFujh1G_0S8hxeWI9ZPMswWsI58e"
  },
  {
    "domain": ".linkedin.com",
    "expirationDate": 1794668421.201815,
    "hostOnly": false,
    "httpOnly": false,
    "name": "_guid",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "b3d31c00-22dc-4f13-8d88-ee8fa2a1a0a3"
  },
  {
    "domain": ".linkedin.com",
    "expirationDate": 1818428427.036184,
    "hostOnly": false,
    "httpOnly": false,
    "name": "bcookie",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "\"v=2&0e3db298-bae7-46d3-822b-ada5f9c8196c\""
  },
  {
    "domain": ".linkedin.com",
    "expirationDate": 1786894227.376271,
    "hostOnly": false,
    "httpOnly": true,
    "name": "__cf_bm",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "3aRg8v3e.lkM5kUAaF5NktYvAmohWsSPYs00TSB3rBQ-1786892425.6084561-1.0.1.1-3w8.R.Hgbp1gykCMV7bAVfEqrB8xFC8URI1X9g3w3WC3vf5d6Lt2jPlgBDvRBeI0lXHFQDB2.fbtEvBiWot3sToBX_6j86TQotON6hMiF4lAXEns4wGGKTPYzWVJPUfm"
  },
  {
    "domain": ".linkedin.com",
    "expirationDate": 1789484421.326346,
    "hostOnly": false,
    "httpOnly": false,
    "name": "lms_analytics",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "AQGLKwvuqwsTQgAAAaALFoKzifH0RoCf5fzH4M7b_7bT_KQdg_EUfVMcQAk2XQperlaCPFujh1G_0S8hxeWI9ZPMswWsI58e"
  },
  {
    "domain": ".linkedin.com",
    "hostOnly": false,
    "httpOnly": true,
    "name": "fptctx2",
    "path": "/",
    "sameSite": null,
    "secure": true,
    "session": true,
    "storeId": null,
    "value": "AQG%252fzqMpgkhEC%252fFiaMnBfybqPf729YhwuF56ZSNXYgofcR2B2friubgGEm7gO7VhLe%252fQg%252bHOcuGr56Phzz3DBjwJsFmSIQdQPTQKHApqGV2ajo7HksOXaCQ6480CB6t3km10NGRfA9ZaKgZ9k%252f9JI1dxqCKBX0%252fsuoCXNqMs3swunmBnn53%252bIfcZyk6hoM8ojyMKqtYwolPMptbqwGeq0LNu0IJ6EqGcoq6krNumIrVUuZlwqp83oS9MwNXLHzGmDBuKM9Gxw8vXyBhOJ6HyiLJI0Si4U9FOoHTRVR%252f46n6SDFUug55RDjCfd1KeYGPMXq4Y91Fc1WXejphJJIbRosDNbNkmznRcd2MHJelDMj4L7Dk2DaIF%252b%252f5Xtcp5VUKcFU9ZUaytYark39NiRnI3W9Fr"
  },
  {
    "domain": ".www.linkedin.com",
    "expirationDate": 1818428409.511931,
    "hostOnly": false,
    "httpOnly": true,
    "name": "li_at",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "AQEDAU7tFnAE7P-ZAAABoAsWVFUAAAGgLyLYVU0AFQHrlt7GI4i7I_BG1rghzQSrWazvg2E9KnEuO4NDPoLO2Z13_220T9nEiqMx1jqFMOGYpYUxywr3_4EvuvF7kXQNHNflGOU8ypeEsOqy7SfW1mIO"
  },
  {
    "domain": ".linkedin.com",
    "hostOnly": false,
    "httpOnly": false,
    "name": "lang",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": true,
    "storeId": null,
    "value": "v=2&lang=es-es"
  },
  {
    "domain": ".linkedin.com",
    "expirationDate": 1786978809.900049,
    "hostOnly": false,
    "httpOnly": false,
    "name": "lidc",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "\"b=TB24:s=T:r=T:a=T:p=T:g=5778:u=327:x=1:i=1786892425:t=1786978808:v=2:sig=AQGcIwW8FF20byrScTLd7gUEbpdcg-Vk\""
  },
  {
    "domain": ".linkedin.com",
    "expirationDate": 1789484421.177479,
    "hostOnly": false,
    "httpOnly": false,
    "name": "AnalyticsSyncHistory",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "AQJFrpUaiO7PLgAAAaALFoIaqRWjqR2ifwLWKlg2N8TqCUpu0ifNe_wU2e5Q78xkVYHrOZsdP3ZaM6dYjV7bLQ"
  },
  {
    "domain": ".www.linkedin.com",
    "expirationDate": 1818428421.326495,
    "hostOnly": false,
    "httpOnly": true,
    "name": "bscookie",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "\"v=1&20260805222717b93965ae-f29c-4fb7-81d4-aca0ef60bc8aAQG7HHh9qTZNJU57XROTRF9EHo2SDSn8\""
  },
  {
    "domain": ".linkedin.com",
    "expirationDate": 1818428291.166042,
    "hostOnly": false,
    "httpOnly": true,
    "name": "dfpfpt",
    "path": "/",
    "sameSite": null,
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "966314d549674ab4affb1a2ca1a073e5"
  },
  {
    "domain": ".www.linkedin.com",
    "expirationDate": 1794668409.512407,
    "hostOnly": false,
    "httpOnly": false,
    "name": "JSESSIONID",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "\"ajax:6778852960168691465\""
  },
  {
    "domain": ".www.linkedin.com",
    "expirationDate": 1818428367.310994,
    "hostOnly": false,
    "httpOnly": true,
    "name": "li_rm",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "AQGv7puPlnD-cQAAAaALFa-Xil9Ni6QnXS1FrkpQS0_QvtutNUerBAs5By0qBp5Yl6pSkrAYAW3Gkv5V0Rao2W-wzjkqabMRxl4ot1hUpY4iSJREoYsioVXD"
  },
  {
    "domain": ".linkedin.com",
    "expirationDate": 1794668427.03591,
    "hostOnly": false,
    "httpOnly": false,
    "name": "li_sugr",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "49b1a7d0-9cb1-4cd5-9dcb-6be6f8a537db"
  },
  {
    "domain": ".www.linkedin.com",
    "expirationDate": 1802448025,
    "hostOnly": false,
    "httpOnly": false,
    "name": "li_theme",
    "path": "/",
    "sameSite": null,
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "light"
  },
  {
    "domain": ".www.linkedin.com",
    "expirationDate": 1802448025,
    "hostOnly": false,
    "httpOnly": false,
    "name": "li_theme_set",
    "path": "/",
    "sameSite": null,
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "app"
  },
  {
    "domain": ".linkedin.com",
    "expirationDate": 1794668409.512115,
    "hostOnly": false,
    "httpOnly": false,
    "name": "liap",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "true"
  },
  {
    "domain": ".www.linkedin.com",
    "expirationDate": 1788102024,
    "hostOnly": false,
    "httpOnly": false,
    "name": "timezone",
    "path": "/",
    "sameSite": null,
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "America/New_York"
  },
  {
    "domain": ".linkedin.com",
    "expirationDate": 1789484426,
    "hostOnly": false,
    "httpOnly": false,
    "name": "UserMatchHistory",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "AQLzBuVQRnjcWgAAAaALFpP7J2kgyBCZeLsv5OArw7NMuAev91GDoUFETZRHXHDeuAVCsZm3_rPF5eHqmET-P_VctDIutrb68O6yokKfvy75c-QG94mYdIePnxz56S6Q3g48BbMkCx7khJCQMXIyz4dQD_qlNrDyPzFwzekbtgoAuRhgv008Fd54aEE7aUKYEzfwLZh4MZsD9yca_pIRvloGNhn2pcPKPKjGuZwSyeWTyho_Y09fu-EjYRKzKW1lSwkwAbsVCCjPo_LI9JiigdqEiwlBcOA6YIviML1hedOqg8mSh-EVkmhjTGgQIf6ob-2MYVbhGH3AuDKinudMlXbS9fnMa5XNE2uJXHpV08l4FV4j2A"
  }
];

function convertToPlaywrightSameSite(sameSite: any): "Strict" | "Lax" | "None" {
  if (!sameSite) return "None";
  const s = String(sameSite).toLowerCase();
  if (s === "strict") return "Strict";
  if (s === "lax") return "Lax";
  return "None";
}

async function main() {
  const profileDir = path.join(__dirname, "../../../browser_profiles");
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const statePath = path.join(profileDir, "linkedin_state.json");

  const playwrightCookies = rawCookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || "/",
    expires: c.expirationDate ? Math.floor(c.expirationDate) : -1,
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure),
    sameSite: convertToPlaywrightSameSite(c.sameSite)
  }));

  const storageState = {
    cookies: playwrightCookies,
    origins: [
      {
        origin: "https://www.linkedin.com",
        localStorage: []
      }
    ]
  };

  fs.writeFileSync(statePath, JSON.stringify(storageState, null, 2), "utf-8");
  console.log(`✅ [OK] Sesión de LinkedIn guardada en ${statePath}`);

  console.log("🌐 Verificando sesión de LinkedIn en vivo con Playwright...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(4000);

  const title = await page.title();
  const currentUrl = page.url();
  console.log(`📄 Título de la página: "${title}"`);
  console.log(`🔗 URL Actual: ${currentUrl}`);

  const profileElement = await page.$(".feed-identity-module, .global-nav__me-photo, button[aria-label*='Perfil'], button[aria-label*='Profile']");
  const isAuthenticated = !currentUrl.includes("login") && !currentUrl.includes("authwall");

  if (isAuthenticated) {
    console.log("🎉 [ÉXITO] ¡Sesión de LinkedIn autenticada y activa!");
  } else {
    console.log("⚠️ [ALERTA] Redirigió a login o authwall.");
  }

  await browser.close();
}

main().catch(console.error);
