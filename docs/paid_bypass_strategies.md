# Estrategias de Evasión Comercial y Escalabilidad de Scraping (Blueprint)

Este documento detalla conceptualmente la arquitectura e integración de herramientas y servicios comerciales de pago cuando se decida escalar el presupuesto operativo de la infraestructura de Tzel.

---

## 1. Bypass de CAPTCHAs por Token (CapSolver)

Cuando portales del condado de Kentucky o Indiana implementen desafíos interactivos o invisibles (como Cloudflare Turnstile, reCAPTCHA v2/v3, o hCaptcha), la infraestructura local puede delegar la resolución a través del intercambio de tokens criptográficos.

### Flujo Técnico del Intercambio
1. **Identificación de la Clave Pública (`sitekey`)**: 
   Cada sitio web que integra Turnstile o reCAPTCHA expone una clave pública en su HTML (generalmente en un atributo `data-sitekey` o en la configuración de inicialización del iframe).
2. **Envío de Parámetros a CapSolver**:
   El script de automatización realiza una llamada HTTP POST a la API de CapSolver enviando:
   - `clientKey`: Credencial del cliente.
   - `task`: Objeto que detalla el tipo de CAPTCHA, la `websiteURL` exacta y la `websiteKey` (sitekey).
3. **Resolución en Segundo Plano**:
   CapSolver delega el desafío a sus propios clústeres optimizados de renderizado y devuelve en pocos segundos un token de validación.
4. **Inyección en el Navegador**:
   El script inyecta el token recibido en la página automatizada (ej. rellenando el selector oculto `#g-recaptcha-response` o ejecutando el callback de éxito `cfTurnstileCallback(token)`) y simula el submit del formulario:

```typescript
// Ejemplo conceptual de inyección del token Turnstile en Playwright
await page.evaluate((token) => {
  // Inyectar el token en el campo del formulario oculto de Cloudflare
  const input = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement;
  if (input) input.value = token;
  
  // O bien, invocar directamente al callback si está registrado en el objeto window
  if (typeof (window as any).onTurnstileSuccess === 'function') {
    (window as any).onTurnstileSuccess(token);
  }
}, solvedToken);
```

---

## 2. Delegación en APIs de Scraping (ZenRows / ScrapingBee)

Para sitios públicos altamente protegidos con tecnologías anti-bot a nivel de comportamiento (como DataDome, Kasada o Imperva), el renderizado local de Playwright consume excesiva RAM y es propenso a bloqueos.

### Arquitectura de Delegación
En lugar de conectar localmente al sitio objetivo, la solicitud HTTP se transmite a través de una API REST segura. 
* **Servicio Gestionado**: El proveedor gestiona en la nube la evasión de huellas digitales de JS, la emulación de comportamiento del ratón/teclado y la rotación automática de agentes de usuario residenciales.
* **Integración en got-scraping**:

```typescript
// Envío de la petición a la API de ZenRows
const targetUrl = "https://example-kentucky-court.gov/records";
const zenrowsUrl = `https://api.zenrows.com/v1/?apikey=${process.env.ZENROWS_API_KEY}&url=${encodeURIComponent(targetUrl)}&js_render=true&premium_proxy=true`;

const response = await makeGotScrapingRequest(zenrowsUrl);
const html = response.body; // Retorna el HTML renderizado listo para parsear con Cheerio
```

---

## 3. Proxies Residenciales Rotativos (IPRoyal / Bright Data)

La geolocalización de las direcciones IP es crítica cuando los servidores públicos de Indiana o Kentucky limitan o bloquean las peticiones originadas fuera de los límites estatales o desde centros de datos (*datacenter IPs*).

### Implementación del Túnel Proxy
* **Protocolo de Enrutamiento**: El orquestador local enruta las peticiones de Playwright o got-scraping a través de un puerto de entrada dinámico de un proveedor residencial (como IPRoyal o Bright Data).
* **Filtrado por Estado**: Se configuran parámetros de autenticación (*sticky sessions* o *port filtering*) para exigir que las IPs asignadas pertenezcan geográficamente a proveedores locales de telecomunicaciones (ej. Charter/Spectrum, AT&T) en Kentucky e Indiana.

```typescript
// Configuración de orquestador con túnel proxy residencial geolocalizado
const proxyConfiguration = {
  // Formato Bright Data: username-zone-country-us-state-ky-session-XYZ:password
  serverUrl: `http://${process.env.PROXY_USER}-country-us-state-ky:${process.env.PROXY_PASSWORD}@zproxy.lum-superproxy.io:22225`
};
```
Esto simula que el tráfico proviene de hogares residenciales de la zona, disminuyendo la probabilidad de bloqueos y captchas preventivos.
