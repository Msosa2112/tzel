import axios from "axios";
import { PDFParse } from "pdf-parse";

async function main() {
  for (let i = 2; i <= 6; i++) {
    const url = `https://www.jeffcomm.org/docs/612-${i}.PDF`;
    try {
      console.log(`Downloading ${url}...`);
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      
      console.log(`Parsing PDF 612-${i} with PDFParse...`);
      const parser = new PDFParse({ data: response.data });
      const textResult = await parser.getText();
      
      console.log(`SUCCESS! Parsed text length: ${textResult.text.length}`);
      console.log(`Parsed text preview:`, JSON.stringify(textResult.text.substring(0, 300)));
      console.log("-------------------------------------------------");
    } catch (err: any) {
      console.error(`Error for 612-${i}:`, err.message || err);
    }
  }
}

main();


