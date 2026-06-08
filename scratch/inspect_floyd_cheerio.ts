import * as fs from "fs";
import * as cheerio from "cheerio";

try {
  const html = fs.readFileSync("floyd_table.html", "utf8");
  const $ = cheerio.load(html);
  
  console.log("=== COLUMNAS DETECTADAS EN FLOYD_TABLE.HTML ===");
  $("tr").slice(0, 20).each((i, tr) => {
    const cells: string[] = [];
    $(tr).find("td").each((_, td) => {
      cells.push($(td).text().trim());
    });
    if (cells.length > 0) {
      console.log(`Fila ${i}:`, JSON.stringify(cells));
    }
  });
} catch (e: any) {
  console.error("Error:", e.message);
}
