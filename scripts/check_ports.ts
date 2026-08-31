import axios from "axios";

async function checkPorts() {
  for (const port of [9222, 9225]) {
    try {
      const res = await axios.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1500 });
      console.log(`✅ Puerto ${port} Activo:`, res.data.Browser);
    } catch (err: any) {
      console.log(`❌ Puerto ${port} cerrado o no responde.`);
    }
  }
}

checkPorts();
