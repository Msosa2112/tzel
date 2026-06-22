import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import Client from "ssh2-sftp-client";
import * as XLSX from "xlsx";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

/**
 * Conecta al servidor SFTP de registros fiscales de Jefferson County,
 * descarga la lista de impuestos morosos y los registra en la base de datos Turso.
 */
export async function runSftpDelinquentIngestor() {
  const sftp = new Client();
  const config = {
    host: "206.196.1.139",
    port: 22,
    username: "jcco",
    password: "J6UueqeaYhN2",
  };

  const remoteDir = "/Delinquent Tax";
  const localTempDir = path.join(__dirname, "../storage/temp_sftp");

  if (!fs.existsSync(localTempDir)) {
    fs.mkdirSync(localTempDir, { recursive: true });
  }

  try {
    console.log(`[SFTP INGESTOR] Conectando a sftp://${config.host}...`);
    await sftp.connect(config);
    console.log(`[SFTP INGESTOR] Listando directorio: ${remoteDir}`);
    
    const files = await sftp.list(remoteDir);
    console.log(`[SFTP INGESTOR] Se encontraron ${files.length} archivos en total.`);

    const xlsxFiles = files.filter(f => f.name.endsWith(".xlsx") || f.name.endsWith(".xls"));
    console.log(`[SFTP INGESTOR] Procesando ${xlsxFiles.length} archivos de Excel.`);

    for (const file of xlsxFiles) {
      const remotePath = `${remoteDir}/${file.name}`;
      const localPath = path.join(localTempDir, file.name);

      console.log(`[SFTP INGESTOR] Descargando ${remotePath} a ${localPath}...`);
      await sftp.fastGet(remotePath, localPath);

      console.log(`[SFTP INGESTOR] Parseando archivo: ${file.name}`);
      await parseAndStoreExcel(localPath);

      // Eliminar el archivo temporal local
      fs.unlinkSync(localPath);
    }
  } catch (err: any) {
    console.error(`[SFTP INGESTOR ERROR]`, err.message);
  } finally {
    await sftp.end();
    console.log(`[SFTP INGESTOR] Conexión SFTP finalizada.`);
  }
}

async function parseAndStoreExcel(filePath: string) {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet) as any[];

    console.log(`[SFTP PARSER] Leídos ${rows.length} registros de la hoja "${sheetName}"`);

    let inserted = 0;
    for (const row of rows) {
      const parcel = findValue(row, ["parcel", "parcel id", "parcel_id", "map block lot", "map_block_lot", "parcelnumber"]);
      const address = findValue(row, ["address", "property address", "property_address", "location"]);
      const debtor = findValue(row, ["taxpayer name", "taxpayer_name", "owner", "owner name", "owner_name", "debtor", "name"]);
      const amountStr = findValue(row, ["tax amount", "tax_amount", "total due", "total_due", "amount", "total"]);

      if (!address || !debtor) {
        continue;
      }

      const debtAmount = amountStr ? parseFloat(String(amountStr).replace(/[^0-9.]/g, "")) : 0;
      const cleanAddr = String(address).trim();
      const cleanDebtor = String(debtor).trim();
      const cleanParcel = parcel ? String(parcel).trim() : "";

      const recordId = "FD_" + crypto.createHash("md5").update(`${cleanAddr}_${cleanDebtor}_tax_lien`).digest("hex");

      await db.execute({
        sql: `
          INSERT INTO financial_distress (
            record_id, case_number, address, county, state, record_type, debt_amount, owner_name, report_date, mls_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_check')
          ON CONFLICT(record_id) DO UPDATE SET
            debt_amount = excluded.debt_amount,
            owner_name = excluded.owner_name,
            address = excluded.address
        `,
        args: [
          recordId,
          cleanParcel || "TAX_LIEN",
          cleanAddr,
          "Jefferson",
          "KY",
          "Tax Lien",
          debtAmount,
          cleanDebtor,
          new Date().toISOString().split("T")[0]
        ]
      });
      inserted++;
    }

    console.log(`[SFTP PARSER] Procesamiento exitoso. ${inserted} registros ingresados/actualizados.`);
  } catch (err: any) {
    console.error(`[SFTP PARSER ERROR] Error al parsear ${filePath}:`, err.message);
  }
}

function findValue(row: any, keys: string[]): any {
  for (const k of Object.keys(row)) {
    const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
    const matched = keys.some(key => {
      const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
      return cleanK === cleanKey;
    });
    if (matched) {
      return row[k];
    }
  }
  return null;
}
