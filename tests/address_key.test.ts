import { describe, expect, test } from "bun:test";
import { getGroupingKey, getUnitInfo, parseAddress, buildPropertyId } from "../utils/address_key";

describe("address_key", () => {
  test("no corta nombres de calle que contienen indicadores de unidad", () => {
    expect(getGroupingKey("123 Manchester Rd, Louisville, KY 40214")).toBe("123_manchester");
    expect(getGroupingKey("45 Community Dr, Jeffersonville, IN 47130")).toBe("45_community");
    expect(getGroupingKey("9 Baptist Church Rd, Corydon, IN")).toBe("9_baptist_church");
    expect(getGroupingKey("77 Forester Ave")).toBe("77_forester");
    expect(getUnitInfo("123 Manchester Rd")).toBe("");
  });

  test("conserva el formato de llave para unidades reales (compatibilidad con datos existentes)", () => {
    expect(getGroupingKey("123 Main St Apt 4, Louisville, KY")).toBe("123_main_apt4");
    expect(getGroupingKey("500 W Market St Suite 200, Louisville")).toBe("500_market_suite200");
    expect(getGroupingKey("10 Oak Ln #3")).toBe("10_oak_3");
    expect(getGroupingKey("8 Elm St Apartment 2B")).toBe("8_elm_apartment2b");
  });

  test("tolera direcciones nulas/vacías sin lanzar", () => {
    expect(getGroupingKey(null)).toBe("");
    expect(getGroupingKey(undefined)).toBe("");
    expect(parseAddress("")).toEqual({ houseNumber: null, coreWords: [] });
  });

  test("buildPropertyId mantiene el formato PROP_ truncado a 40", () => {
    expect(buildPropertyId("123_main_apt4")).toBe("PROP_123_main_apt4");
    expect(buildPropertyId("x".repeat(60)).length).toBe(5 + 40);
  });
});
