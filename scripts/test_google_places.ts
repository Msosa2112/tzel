import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

async function testGooglePlaces(address: string) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  console.log(`🗺️ Consultando Google Places API para: "${address}" con Key: ${apiKey?.substring(0, 8)}...`);

  try {
    // 1. Text Search / Find Place
    const findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(address + " Louisville KY")}&inputtype=textquery&fields=place_id,name,formatted_address&key=${apiKey}`;
    const findRes = await axios.get(findUrl);
    console.log("Find Place:", JSON.stringify(findRes.data, null, 2));

    const placeId = findRes.data?.candidates?.[0]?.place_id;
    if (placeId) {
      // 2. Place Details (Teléfono, Sitio Web, Nombre)
      const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,international_phone_number,website,formatted_address&key=${apiKey}`;
      const detailRes = await axios.get(detailUrl);
      console.log("Place Details:", JSON.stringify(detailRes.data, null, 2));
    }
  } catch (err: any) {
    console.error("Error Google Places:", err.message);
  }
}

testGooglePlaces("808 Brookline Ave");
