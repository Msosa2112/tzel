import { makeGotScrapingRequest } from "../scrapers/got_scraping_helper";
import * as cheerio from "cheerio";
import axios from "axios";

async function testFastPeopleSearch(address: string, city: string, state: string) {
  console.log(`\n--- Test FastPeopleSearch para: ${address}, ${city}, ${state} ---`);
  const cleanStreet = address.replace(/,/g, "").trim().replace(/\s+/g, "-");
  const cleanCityState = `${city}-${state}`.replace(/\s+/g, "-");
  const url = `https://www.fastpeoplesearch.com/address/${cleanStreet}_${cleanCityState}`;
  console.log(`URL: ${url}`);

  try {
    const res = await makeGotScrapingRequest(url);
    console.log(`Status HTTP: ${res.statusCode}`);
    const $ = cheerio.load(res.body);
    const names: string[] = [];
    const phones: string[] = [];

    $(".card").each((_, el) => {
      const name = $(el).find(".card-title, h2, h3, a[href*='/name/']").text().trim();
      if (name) names.push(name);
      $(el).find("a[href*='tel:']").each((_, p) => {
        phones.push($(p).text().trim());
      });
    });

    console.log(`Encontrados en FastPeopleSearch: Nombres: ${names.length}, Teléfonos: ${phones.length}`);
    if (names.length > 0) console.log("Nombres:", names.slice(0, 5));
    if (phones.length > 0) console.log("Teléfonos:", phones.slice(0, 5));
  } catch (err: any) {
    console.error("Error FastPeopleSearch:", err.message);
  }
}

async function testThatsthem(address: string, city: string, state: string) {
  console.log(`\n--- Test ThatsThem para: ${address}, ${city}, ${state} ---`);
  const url = `https://thatsthem.com/address/${encodeURIComponent(address)}-${encodeURIComponent(city)}-${encodeURIComponent(state)}`;
  console.log(`URL: ${url}`);

  try {
    const res = await makeGotScrapingRequest(url);
    console.log(`Status HTTP: ${res.statusCode}`);
    const $ = cheerio.load(res.body);
    const names: string[] = [];
    const phones: string[] = [];

    $(".That-s-Them-record").each((_, el) => {
      const name = $(el).find(".name").text().trim();
      if (name) names.push(name);
      const phone = $(el).find(".phone").text().trim();
      if (phone) phones.push(phone);
    });

    console.log(`Encontrados en ThatsThem: Nombres: ${names.length}, Teléfonos: ${phones.length}`);
    if (names.length > 0) console.log("Nombres:", names.slice(0, 5));
    if (phones.length > 0) console.log("Teléfonos:", phones.slice(0, 5));
  } catch (err: any) {
    console.error("Error ThatsThem:", err.message);
  }
}

async function runTests() {
  await testFastPeopleSearch("808 BROOKLINE AVE", "Louisville", "KY");
  await testThatsthem("808 Brookline Ave", "Louisville", "KY");
}

runTests();
