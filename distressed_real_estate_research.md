# Informe de Investigación: Adquisición Inmobiliaria Distressed (Kentucky e Indiana)

Este documento detalla las estrategias, marcos legales, diferencias estatales y herramientas de costo $0 (Open Source) para localizar y adquirir propiedades inmobiliarias con altos descuentos (precios bajo mercado) en los estados de Kentucky e Indiana.

---

## 1. Métodos para Encontrar Propiedades a "Precio Ridículo" (Costo $0)

Para operar con presupuesto cero en la fase inicial, nos enfocamos en bases de datos públicas y derechos de información gubernamental.

### A. Programas de Land Banks (Bancos de Tierras Municipales)
Los Land Banks son entidades gubernamentales que adquieren propiedades abandonadas, ejecutadas o en ruinas con el fin de revitalizar vecindarios. No buscan el mejor postor, sino el mejor proyecto.

*   **Louisville Landbank (Kentucky):**
    *   **Cómo funciona:** A través del *Property Portal* de Louisville Metro, puedes filtrar inventario por "Structure" (casas a reparar) o "Lot" (lotes vacíos). Tienen programas donde venden propiedades por montos simbólicos (a veces $1,000 o menos) a desarrolladores que demuestren capacidad de restaurarlas.
    *   **Requisitos:** Presentar plan de obra, presupuesto detallado y prueba de fondos (*Proof of Funds*) para la remodelación.
*   **Indianapolis Land Bank / "Vacant to Vibrant" (Indiana):**
    *   **Cómo funciona:** Administrado por el *Department of Metropolitan Development (DMD)*. Publican mensualmente listas de casas vacantes disponibles para adquisición.
    *   **Requisitos:** Compromiso de desarrollo en plazos estrictos (usualmente un acuerdo de proyecto de 2 años). Dan prioridad a quienes planean vivir en ellas o proveer vivienda asequible.

### B. Listas de Violaciones de Código (Code Violations)
Las propiedades con multas acumuladas por la ciudad (malezas altas, basura acumulada, daños estructurales, ventanas rotas) representan a propietarios altamente motivados que no pueden o no quieren mantener el inmueble.
*   **Método de obtención ($0):** En lugar de pagar suscripciones caras, se solicita la lista de violaciones activas de código directamente al ayuntamiento mediante una petición de registros abiertos (**FOIA Request** en Indiana, u **Open Records Request** en Kentucky).
*   **El negocio:** Propones una compra rápida en efectivo antes de que la ciudad ejecute la propiedad o las multas consuman todo su valor.

### C. Impuestos Delincuentes (Tax Delinquency Lists)
Propietarios que llevan 1 o 2 años sin pagar impuestos prediales. Están en riesgo inminente de perder su casa.
*   **Método de obtención ($0):** Los condados publican gratuitamente la lista de todas las cuentas de impuestos pendientes antes de las subastas anuales. Se solicita el archivo Excel al *County Treasurer* o *Sheriff's Office*.

### D. Casos de Sucesión (Probate Records)
Cuando un propietario fallece, los herederos suelen querer vender la propiedad rápidamente para repartir el dinero, evitar pagar mantenimiento o saldar deudas de la sucesión.
*   **Método de obtención ($0):** Monitorear semanalmente el portal del tribunal testamentario local (*Probate Court Docket*). Los expedientes de sucesiones abiertas son registros públicos.

---

## 2. Marco Legal y Comparativa: Kentucky vs. Indiana

Comprender la ley de cada estado es fundamental para no perder capital en procesos legales largos.

| Concepto | Kentucky (KY) | Indiana (IN) |
| :--- | :--- | :--- |
| **Tipo de Subasta Judicial** | **Master Commissioner Sale** | **Sheriff Sale** |
| **Periodo de Redención (Foreclosure)** | **6 Meses** (Solo si la oferta ganadora es menor a 2/3 del avalúo judicial). Si es mayor, es inmediato. | **No hay** periodo de redención posterior a la subasta. La venta es final e inmediata. |
| **Posesión de la Propiedad** | El comprador recibe escritura y posesión, pero si hay derecho de redención, el dueño anterior puede recuperar la casa pagando el precio de subasta + 10% de interés anual. | Inmediata tras la adjudicación y firma de la escritura del Sheriff (*Sheriff's Deed*). |
| **Tipo de Subasta de Impuestos** | **Tax Lien State** (Se subasta el *Certificate of Delinquency* / la deuda tributaria). | **Tax Lien State** (Se subasta el *Tax Sale Certificate* / la deuda tributaria). |
| **Periodo de Redención (Impuestos)** | **1 Año** desde la compra del certificado. | **1 Año** desde la compra del certificado de venta. |
| **Proceso para obtener el título (Impuestos)** | **Complejo:** El inversionista debe iniciar un juicio civil de ejecución hipotecaria (*Judicial Foreclosure*) tras el año de espera para forzar la venta de la propiedad y tomar el título. | **Sencillo:** Tras el año de espera, el inversionista notifica al dueño y pide directamente al tribunal la emisión del *Tax Deed* sin necesidad de un juicio de ejecución completo. |

> [!WARNING]
> En **Kentucky**, si compras una casa en subasta judicial por menos de 2/3 de su valor tasado, evita realizar remodelaciones costosas durante los primeros 6 meses. Si el dueño original ejerce su derecho de redención, solo está obligado a reembolsarte el precio de compra, 10% de interés y únicamente reparaciones de emergencia o mantenimiento básico que exija el código local.

---

## 3. Kit de Herramientas Open Source / Costo $0

Para orquestar tu sistema de adquisición con costo de software cero, utilizaremos las siguientes herramientas libres:

### A. Google Dorking (Extracción de archivos ocultos)
Operadores avanzados para encontrar listas de herencias, quiebras o violaciones de código subidas a servidores públicos:
*   `site:*.in.gov "code violations" filetype:csv OR filetype:xlsx` (Violaciones de código en Indiana).
*   `site:*.gov "probate case list" filetype:pdf` (Casos de sucesiones activos).

### B. Python (Requests & BeautifulSoup)
Para programar rastreadores que entren a las páginas de los Sheriff de Indiana o Master Commissioners de Kentucky y descarguen el calendario de subastas semanal.
*   *Ventaja:* Evitas pagar por plataformas como Foreclosure.com o PropStream.

### C. Turso (Base de Datos Relacional SQL - Capa Gratuita)
Como demostramos en [test_turso.py](file:///E:/DT.t/tzel/test_turso.py), usamos la versión serverless de SQLite en la nube de Turso con sus 9GB de espacio gratis para estructurar todos tus leads.

### D. N8N (Self-Hosted en tu Computadora)
N8N es una herramienta de automatización visual (alternativa a Zapier).
*   *Cómo se usa gratis:* Lo instalas en tu computadora localmente usando Node.js o Docker.
*   *Qué hace:* Puede conectarse a tu base de datos de Turso, revisar cuando entra una propiedad nueva en Louisville, y enviarte una alerta a tu Telegram o correo electrónico automáticamente de forma gratuita.

### E. QGIS (Sistemas de Información Geográfica)
Herramienta de escritorio Open Source para mapear coordenadas.
*   *Uso:* Puedes importar el archivo de catastros del condado (GIS Data) y cruzarlo con tu lista de casas abandonadas para ubicar visualmente dónde se concentran las mejores oportunidades para hacer *Fix & Flip* por vecindarios.
