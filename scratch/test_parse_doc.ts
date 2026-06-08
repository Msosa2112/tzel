import axios from "axios";

async function fetchDebtAmount(caseNumber: string): Promise<number | null> {
  const url = `https://www.jeffcomm.org/docs/handbill/${caseNumber}.doc`;
  try {
    console.log(`Downloading handbill for ${caseNumber}: ${url}`);
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 10000
    });
    
    const buffer = Buffer.from(response.data);
    const text = buffer.toString("latin1");
    
    // Test matches
    const regex = /amount to be raised by the judgment is \$([0-9,]+(?:\.[0-9]{2})?)/i;
    const match = text.match(regex);
    if (match) {
      const amountStr = match[1].replace(/,/g, "");
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        return amount;
      }
    } else {
      console.log("Regex did not match for", caseNumber);
      // Let's print a small slice of text around 'judgment'
      const idx = text.toLowerCase().indexOf("judgment");
      if (idx !== -1) {
        console.log("Judgment context:", JSON.stringify(text.substring(idx - 50, idx + 150)));
      }
    }
  } catch (err: any) {
    console.error(`Error fetching ${caseNumber}:`, err.message || err);
  }
  return null;
}

async function main() {
  const cases = ["25CI401282", "24CI007005", "23CI400604"];
  for (const c of cases) {
    const amt = await fetchDebtAmount(c);
    console.log(`Parsed debt amount for ${c}:`, amt);
    console.log("------------------------");
  }
}

main().catch(console.error);
