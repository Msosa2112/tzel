# 📋 Resumen Ejecutivo de Actualizaciones e Integraciones — TZEL OSINT Pipeline

> **Fecha de Actualización:** 30 de Agosto, 2026  
> **Estado del Sistema:** Operativo y en Ejecución  
> **Base de Datos:** Turso Cloud (libSQL / AWS)  

---

## 1. 🎯 Reestructuración del Criterio High Yield (Regla 20% MCA)

* **Problema anterior:** Se dependía del ARV (*After Repair Value*) estimado por internet, el cual es especulativo al ser imposible verificar la condición física interna real del inmueble de forma remota.
* **Nueva Regla Implementada:** Se eliminó el ARV especulativo y se adoptó el **MCA (*Master Commissioner Appraisal* / Tasación Judicial Oficial)** frente a la **Deuda Total**:
  $$\text{Deuda Total} \le 80\% \times \text{MCA} \quad \Longleftrightarrow \quad \text{Margen de Tasación} \ge 20\%$$
* **Archivos Actualizados:**
  * [`underwriting/underwriter.ts`](../underwriting/underwriter.ts): Función `isHighYieldProperty` refactorizada con `minMarginRatio = 0.20`.
  * [`cross_reference.ts`](../cross_reference.ts): Selección directa de `appraisal_value` y scoring High Yield estricto.
  * [`indiana_court_crawler.ts`](../indiana_court_crawler.ts): Evaluación de expedientes de Indiana contra valor de tasación/referencia.
  * [`scrapers/pdf_appraisal_worker.ts`](../scrapers/pdf_appraisal_worker.ts): Cálculo y persistencia automática de `is_high_yield` al extraer valores desde PDFs de las cortes.

---

## 2. 🔍 Skip Tracing OSINT en Cascada (*Waterfall Architecture*)

* **Desbloqueo de Leads:** Se eliminó la restricción que limitaba la búsqueda de teléfonos únicamente a High Yields, permitiendo enriquecer a todos los propietarios individuales de subastas y propiedades en infracción.
* **Arquitectura de Búsqueda y Sigilo (*Playwright Stealth*):**
  1. Detección automática de SearXNG local en Docker (`http://localhost:8080`).
  2. Fallback a navegadores *Chromium Headless* camuflados contra detección anti-bot (*Playwright Stealth*).
  3. Búsqueda y reescritura en *Yahoo Search*.
  4. Extracción directa y normalización de números celulares y fijos desde directorios públicos (*FastPeopleSearch*, *TruePeopleSearch*, *Whitepages*).
* **Resiliencia ante Desconexión:** El script maneja errores de red temporales (`ERR_INTERNET_DISCONNECTED`) y se reanuda de manera autónoma sin perder el estado.
* **Métricas Alcanzadas en la Base de Datos:**
  * 🏛️ **Subastas Judiciales (*Foreclosures*):** **158 propiedades con teléfono verificado** *(100% de la cola completada)*.
  * 🏚️ **Violaciones de Código (*Code Violations*):** **264 propiedades con teléfono verificado**.
  * 📞 **Total Global:** **Más de 420 contactos directos consolidados en Turso DB**.

---

## 3. 🤖 Actualización de Modelos de IA (Google Gemini 3.6 Flash)

* **Migración de Endpoints:** Se actualizaron las integraciones de IA al modelo **`gemini-3.6-flash`** (disponible con respuesta HTTP 200 y procesamiento multimodal acelerado).
* **Módulos Actualizados:**
  * [`scrapers/pdf_appraisal_worker.ts`](../scrapers/pdf_appraisal_worker.ts): Extracción multimodal de tasaciones judiciales desde documentos PDF de cortes.
  * [`scrapers/lien_detector.ts`](../scrapers/lien_detector.ts): Detección de gravámenes ocultos (*junior liens*, *tax liens*, segundos créditos hipotecarios).
  * [`scrapers/debt_retry_sweep.ts`](../scrapers/debt_retry_sweep.ts): Extracción de montos de juicio y saldos pendientes.

---

## 4. 📲 Sistema de Monitoreo y Notificaciones a Telegram

* **Daemon de Monitoreo:** Script en segundo plano que vigila el progreso de las colas de la base de datos y despacha alertas automáticas al finalizar.
* **Canal Centralizado:** Integración con **Telegram Bot** (`TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`) para recibir:
  * Mensajes push inmediatos en el celular.
  * Fichas completas de propiedades High Yield calificadas con fotos, tasación MCA, deuda y teléfonos de contacto directo.
* **Prueba de Conexión:** Mensaje interactivo de prueba validado y entregado con éxito.

---

## 5. 🛠️ Extensiones Instaladas en el IDE desde Open-VSX

Se descargaron e instalaron directamente en el entorno (`C:\Users\migue\.antigravity-ide\extensions`):

| Extensión | ID Open-VSX | Utilidad Principal en TZEL |
| :--- | :--- | :--- |
| **Database Client** | `cweijan.vscode-database-client2` | Explorador visual para tablas de SQLite, libSQL/Turso y Redis desde la barra lateral. |
| **Code Runner** | `formulahendry.code-runner` | Botón ▶️ "Run" para ejecutar scripts (`.ts`, `.py`, `.bat`) con un clic o atajo `Ctrl+Alt+N`. |
| **SQLite Viewer** | `qwtel.sqlite-viewer` | Visor gráfico para abrir y consultar archivos `.sqlite` y `.db` directamente. |
| **REST Client** | `humao.rest-client` | Pruebas de endpoints HTTP y APIs (SearXNG, FlareSolverr, Spark MLS). |
| **Rainbow CSV** | `mechatroner.rainbow-csv` | Visualización y coloreado por columnas de CSVs de catastro y subastas. |
| **Prettier** | `esbenp.prettier-vscode` | Formateador consistente de código TypeScript, JSON y HTML. |

---

## 6. ⚡ Orquestador Optimizado de Pipeline (`run_remaining_pipeline.ts`)

* **Alineación con las Prioridades:** Dado que las violaciones de código no son de máxima prioridad, se creó un orquestador dedicado ([`run_remaining_pipeline.ts`](../run_remaining_pipeline.ts)) que omite el barrido masivo de violaciones y ejecuta directamente:
  1. **Auditoría Financiera y Tasaciones:** Análisis de PDFs de cortes con Gemini.
  2. **Auditoría de Gravámenes & Títulos:** Verificación de deudas ocultas.
  3. **Fotos Catastrales:** Descarga de imágenes oficiales desde PVA / eCCLIX.
  4. **Scoring de Inteligencia (SSI):** Cálculo del índice de estrés para clasificar las mejores oportunidades.
  5. **Despacho a Telegram:** Envío de reportes ejecutivos de subastas High Yield.
  6. **Auditoría de Excedentes:** Liquidación de *Surplus Funds*.
