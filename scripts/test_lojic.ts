import { GISRestClient } from "../scrapers/gis_rest_client";

async function testLojic() {
  const client = new GISRestClient();
  const address = "808 BROOKLINE AVE";
  console.log(`🏛️ Consultando Catastro Oficial LOJIC Jefferson County para: ${address}`);

  const parcel = await client.queryJeffersonParcelByAddress(address);
  console.log("📍 Parcelas LOJIC:", JSON.stringify(parcel, null, 2));
}

testLojic();
