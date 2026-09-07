# TZEL - REGLAS DE DESARROLLO, MEMORIA Y ARQUITECTURA

Este documento define el estado del sistema, los contratos de datos y las directrices obligatorias para cualquier sesión de trabajo en el proyecto TZEL.

---

## 1. Misión del Proyecto: De Inteligencia a Adquisición (Acquisition OS)
Tzel es un **Acquisition Operating System** para inversión inmobiliaria en Kentucky (Louisville / Jefferson County) e Indiana. Integra:
* Scrapers de subastas judiciales (Master Commissioner, Sheriff Sales, Tax Sales, Pre-Foreclosures, Landbank).
* Detección de gravámenes ocultos y deudas con Gemini AI multimodal.
* Skip tracing en cascada (SearXNG + Playwright stealth + directorios públicos).
* Mapa Táctico 360 con Centro de Comando de Adquisición (`index.html` + `tzel_map_server.ts`).

---

## 2. Reglas Invariantes de Clasificación y Filtrado (Truth in Advertising)

### A. Dockets Incompletos / Sin Deuda ni Avalúo
* **Condición**: `totalDebt === 0 || marketValue <= 0 || isUnknownOwner`
  * (Donde `isUnknownOwner = !lead.ownerName || /desconocido|unknown|no especificado/i.test(lead.ownerName.trim())`)
* **Marcador en Mapa**:
  * Color: Slate Grey (`#64748b`).
  * Icono SVG: Reloj (`clock`).
  * Clase CSS: `waiting-debt`.
  * Halo / Pulso de alarma: **SUPRIMIDO** (`display: none !important`).
* **Valores Financieros y Ofertas**:
  * **NUNCA** inventar valores base ni ARV por defecto ($180,000 o $220,000).
  * Mostrar `"Pendiente Valor PVA"` y ofertas en `"Pendiente Valor"`.
* **Opportunity Score**: Capped en **20/100** con acción `"EXPEDIENTE INCOMPLETO: AUDITAR EN CORTE"`.

### B. Marcador Rojo de Ejecución Urgente (`execution-scheduled`)
* **Color**: `#ef4444`, icono `shieldAlert`.
* **Condición**: Requiere estrictamente que la subasta tenga titular verificado y deuda confirmada (`totalDebt > 0`).

### C. Filtro de "BUENOS DEALS" (`#btn-deals`)
* **Condición estricta**:
  `marketValue > 0 && totalDebt > 0 && equitySpread >= Math.max(30000, marketValue * 0.25) && !isUnknownOwner && hasContact && opportunityScore >= 55`
* Todo prospecto sin contacto directo verificado (teléfono o email) o sin datos mínimos queda **100% excluido** de "Buenos Deals" y clasificado como `PENDIENTE CONTACTO`. Solo prospectos accionables con titular y teléfono pueden calificar.

### D. Pestaña "Top Oportunidades" del Timeline
* Filtra leads incompletos; exige `marketValue > 0 && totalDebt > 0 && equitySpread >= 30000 && !isUnknownOwner && opportunityScore >= 55`.

---

## 3. Componentes del Acquisition Command Center
* **Ruta de Apertura**: `openAcquisitionCommandCenter(lead)` o botón "Ver Ficha Táctica" en popups y fichas.
* **Módulos**:
  1. *Dual Scores*: Opportunity Score (0-100) + SSI (Seller Stress Index).
  2. *Why This Deal*: 5 puntos institucionales. Si el lead es incompleto, emite advertencia de auditoría judicial preliminar.
  3. *Call Brief*: Apertura personalizada y 7 preguntas de cualificación.
  4. *Biblioteca de Objeciones*: 7 objeciones de propietarios con respuestas validadas.
  5. *Rango de Ofertas en 3 Niveles*: Conservadora (65% ARV - rehab), Target (70% ARV - rehab), MAO (75% ARV - rehab).
  6. *Kanban CRM*: Embudo de 6 etapas sincronizado con `localStorage` y API.

---

## 4. Ejecución del Servidor
* Servidor local táctico: `bun tzel_map_server.ts` (corre en el puerto 3000).
* Acceso: `http://localhost:3000`.
