import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { PDFParse } from "pdf-parse";

const TARGET_DIRS = ["./storage", "./scratch"];
const CACHE_FILE = ".indexed_files.json";
const HISTER_INDEX_URL = "http://localhost:5005/api/index";
const HISTER_ADD_URL = "http://localhost:5005/api/add";

interface IndexedState {
  [filePath: string]: {
    mtime: number;
    indexedAt: string;
  };
}

let indexedState: IndexedState = {};

// Load cache
if (fs.existsSync(CACHE_FILE)) {
  try {
    indexedState = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch (err: any) {
    console.warn(`[INDEXER] Error al cargar cache .indexed_files.json: ${err.message}`);
  }
}

// Save cache
function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(indexedState, null, 2), "utf-8");
  } catch (err: any) {
    console.error(`[INDEXER] Error al guardar cache: ${err.message}`);
  }
}

// Find files recursively
function findPdfFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    // Skip Hister source code directory and node_modules
    if (file === "hister_src" || file === "node_modules" || file === ".git") continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      findPdfFiles(fullPath, fileList);
    } else if (stat.isFile() && file.toLowerCase().endsWith(".pdf")) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

// Extract metadata from file path/name
function parseMetadata(filePath: string) {
  let county = "Jefferson";
  let state = "KY";

  const cleanPath = filePath.toLowerCase();
  if (cleanPath.includes("clark")) {
    county = "Clark";
    state = "IN";
  } else if (cleanPath.includes("floyd")) {
    county = "Floyd";
    state = "IN";
  } else if (cleanPath.includes("oldham")) {
    county = "Oldham";
    state = "KY";
  } else if (cleanPath.includes("bullitt")) {
    county = "Bullitt";
    state = "KY";
  } else if (cleanPath.includes("shelby")) {
    county = "Shelby";
    state = "KY";
  } else if (cleanPath.includes("harrison")) {
    county = "Harrison";
    state = "IN";
  }

  return { county, state };
}

// Index single PDF
async function indexPdf(filePath: string): Promise<boolean> {
  const absolutePath = path.resolve(filePath);
  const fileUrl = `file:///${absolutePath.replace(/\\/g, "/")}`;
  const fileName = path.basename(filePath);

  console.log(`[INDEXER] Procesando PDF: ${fileName} (${filePath})...`);

  try {
    const dataBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: dataBuffer });
    const pdfData = await parser.getText();
    const extractedText = pdfData.text ? pdfData.text.trim() : "";

    if (!extractedText) {
      console.warn(`[INDEXER WARNING] Texto vacío extraído de ${fileName}`);
      return false;
    }

    const { county, state } = parseMetadata(filePath);

    const payload = {
      url: fileUrl,
      title: fileName,
      content: extractedText,
      metadata: {
        county,
        state,
        acquisition_type: "As-Is"
      }
    };

    try {
      // Try /api/index first
      const res = await axios.post(HISTER_INDEX_URL, payload, {
        headers: { 
          "Content-Type": "application/json",
          "Origin": "hister://"
        },
        timeout: 10000
      });
      const contentType = res.headers["content-type"];
      if (typeof contentType === "string" && contentType.includes("text/html")) {
        throw new Error("404 (Redirected to SPA)");
      }
      console.log(`[INDEXER SUCCESS] Indexado en Hister (/api/index): ${fileName}`);
    } catch (apiErr: any) {
      // Fallback to /api/add
      console.warn(`[INDEXER WARN] /api/index no disponible o falló (${apiErr.message}). Usando fallback /api/add...`);
      const fallbackPayload = {
        url: fileUrl,
        title: fileName,
        text: extractedText,
        label: `${county}, ${state} (As-Is)`
      };
      const resAdd = await axios.post(HISTER_ADD_URL, fallbackPayload, {
        headers: { 
          "Content-Type": "application/json",
          "Origin": "hister://"
        },
        timeout: 10000
      });
      const contentTypeAdd = resAdd.headers["content-type"];
      if (typeof contentTypeAdd === "string" && contentTypeAdd.includes("text/html")) {
        throw new Error("404 (Redirected to SPA on /api/add)");
      }
      console.log(`[INDEXER SUCCESS] Indexado en Hister (/api/add): ${fileName}`);
    }

    return true;
  } catch (err: any) {
    console.error(`[INDEXER ERROR] Falló indexación de ${fileName}: ${err.message}`);
    return false;
  }
}

// Main scan cycle
async function scanAndIndex() {
  console.log(`[INDEXER] Iniciando escaneo de directorios: ${TARGET_DIRS.join(", ")}`);
  let pdfFiles: string[] = [];
  for (const dir of TARGET_DIRS) {
    pdfFiles = findPdfFiles(dir, pdfFiles);
  }

  console.log(`[INDEXER] Encontrados ${pdfFiles.length} archivos PDF.`);
  let newlyIndexedCount = 0;

  for (const file of pdfFiles) {
    try {
      const stats = fs.statSync(file);
      const lastModified = stats.mtimeMs;

      // Index if new or modified
      if (!indexedState[file] || indexedState[file].mtime !== lastModified) {
        const success = await indexPdf(file);
        if (success) {
          indexedState[file] = {
            mtime: lastModified,
            indexedAt: new Date().toISOString()
          };
          saveCache();
          newlyIndexedCount++;
        }
      }
    } catch (fileErr: any) {
      console.error(`[INDEXER ERROR] Error al leer archivo ${file}: ${fileErr.message}`);
    }
  }

  if (newlyIndexedCount > 0) {
    console.log(`[INDEXER] Escaneo completo. Se indexaron ${newlyIndexedCount} nuevos PDFs.`);
  } else {
    console.log(`[INDEXER] Escaneo completo. No se encontraron nuevos PDFs para indexar.`);
  }
}

// Run loop
const pollIntervalSeconds = 15;
console.log(`[INDEXER] Monitoreo iniciado. Escaneando cada ${pollIntervalSeconds} segundos...`);
scanAndIndex();
setInterval(scanAndIndex, pollIntervalSeconds * 1000);
