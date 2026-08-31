import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

async function autoLoginFacebookWithCaptcha() {
  const emailOrPhone = "5026587853";
  const password = "Realmadrid00@";

  const profileDir = path.join(__dirname, "../../../browser_profiles");
  const statePath = path.join(profileDir, "facebook_state.json");

  console.log("=================================================================");
  console.log("🔐 CONTINUANDO LOGIN EN FACEBOOK (RESOLVIENDO CAPTCHA/2FA) 🔐");
  console.log("=================================================================");

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();

  try {
    console.log("1. Navegando a https://www.facebook.com/login ...");
    await page.goto("https://www.facebook.com/login", { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(2000);

    // Escribir credenciales
    const emailInput = await page.$('input[name="email"], input#email');
    if (emailInput) await emailInput.fill(emailOrPhone);

    const passInput = await page.$('input[name="pass"], input#pass');
    if (passInput) {
      await passInput.fill(password);
      await page.waitForTimeout(500);
      await passInput.press("Enter");
    }

    await page.waitForTimeout(6000);
    console.log(`URL tras login: ${page.url()}`);

    // Si aparece reCAPTCHA "I'm not a robot"
    try {
      const captchaFrame = page.frameLocator('iframe[title*="reCAPTCHA"], iframe[src*="recaptcha"]');
      const anchor = captchaFrame.locator('#recaptcha-anchor, .recaptcha-checkbox');
      if (await anchor.isVisible({ timeout: 5000 })) {
        console.log("2. reCAPTCHA detectado. Haciendo clic en 'No soy un robot'...");
        await anchor.click();
        await page.waitForTimeout(5000);

        // Click en continuar si aparece botón
        const submitBtn = await page.$('button[type="submit"], button:has-text("Continuar"), button:has-text("Continue")');
        if (submitBtn) {
          await submitBtn.click();
          await page.waitForTimeout(5000);
        }
      }
    } catch (cErr: any) {
      console.log(`Nota sobre captcha: ${cErr.message}`);
    }

    const ssPath = path.join(profileDir, "fb_captcha_result.png");
    await page.screenshot({ path: ssPath });
    console.log(`Captura guardada en: ${ssPath}`);

    const cookies = await context.cookies();
    const hasUserCookie = cookies.some(c => c.name === "c_user");

    if (hasUserCookie) {
      console.log("🎉 ¡INICIO DE SESIÓN EXITOSO! Cookie 'c_user' capturada.");
      await context.storageState({ path: statePath });
      console.log(`✅ Sesión guardada en: ${statePath}`);
      return true;
    }

    console.log("Verificando si Facebook pide código SMS o App...");
    const urlAfter = page.url();
    console.log(`URL final: ${urlAfter}`);

  } catch (err: any) {
    console.error(`❌ Error: ${err.message}`);
  } finally {
    await browser.close();
  }

  return false;
}

autoLoginFacebookWithCaptcha().catch(console.error);
