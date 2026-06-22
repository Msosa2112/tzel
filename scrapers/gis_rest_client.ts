import { makeGotScrapingRequest } from "./got_scraping_helper";

export interface GISFeature {
  attributes: Record<string, any>;
  geometry?: any;
}

export interface GISQueryResponse {
  features?: GISFeature[];
  error?: any;
}

/**
 * Cliente REST de ArcGIS para consultar servidores geográficos públicos de Kentucky e Indiana sin autenticación.
 */
export class GISRestClient {
  /**
   * Realiza una consulta genérica a un MapServer/FeatureServer de ArcGIS.
   */
  async queryArcGIS(url: string, whereClause: string, outFields = "*"): Promise<GISFeature[]> {
    const params = new URLSearchParams({
      where: whereClause,
      outFields,
      f: "json",
      returnGeometry: "false",
    });

    const fullUrl = `${url}?${params.toString()}`;
    console.log(`[GIS REST CLIENT] Consultando ArcGIS REST: ${fullUrl}`);

    try {
      const response = await makeGotScrapingRequest(fullUrl);
      const data = JSON.parse(response.body) as GISQueryResponse;

      if (data.error) {
        throw new Error(`Error de ArcGIS REST: ${JSON.stringify(data.error)}`);
      }

      return data.features || [];
    } catch (err: any) {
      console.error(`[GIS REST CLIENT ERROR] Falló la consulta a ${url}:`, err.message);
      return [];
    }
  }

  /**
   * Consulta las parcelas de Jefferson County (LOJIC OpenData PVA) por código postal.
   */
  async queryJeffersonParcelsByZip(zip: string): Promise<GISFeature[]> {
    const url = "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataPVA/MapServer/1/query";
    const where = `ZIP_CODE = '${zip}'`;
    return this.queryArcGIS(url, where);
  }

  /**
   * Consulta las parcelas de Jefferson County (LOJIC OpenData PVA) por dirección.
   */
  async queryJeffersonParcelByAddress(address: string): Promise<GISFeature[]> {
    const url = "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataAddresses/MapServer/0/query";
    const cleanAddr = address.split(",")[0].trim().toUpperCase();
    const houseNumberMatch = cleanAddr.match(/^\d+/);
    let where = `FULL_ADDRESS = '${cleanAddr}'`;
    if (houseNumberMatch) {
      const houseNum = houseNumberMatch[0];
      const streetPart = cleanAddr.replace(houseNum, "").trim().split(/\s+/)[0];
      if (streetPart) {
        where = `FULL_ADDRESS LIKE '${houseNum} ${streetPart}%'`;
      }
    }
    return this.queryArcGIS(url, where);
  }


  /**
   * Consulta el visor CAMA para tasaciones y características por ID de parcela.
   */
  async queryCamaViewerByParcel(parcelId: string): Promise<GISFeature[]> {
    const url = "https://gis.lojic.org/maps/rest/services/PvaGis/CamaViewer/MapServer/0/query"; 
    const where = `PARCEL_ID = '${parcelId}'`;
    return this.queryArcGIS(url, where);
  }

  /**
   * Consulta el catastro de Indiana (IGIO GIO) por ID de parcela del estado.
   */
  async queryIndianaParcelsById(stateParcelId: string): Promise<GISFeature[]> {
    const url = "https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query";
    const where = `state_parcel_id = '${stateParcelId}'`;
    return this.queryArcGIS(url, where);
  }

  /**
   * Consulta las parcelas de Jefferson County (LOJIC OpenData PVA) por ID de parcela para obtener atributos vectoriales (LRSN, etc.).
   */
  async queryJeffersonParcelsByParcelId(parcelId: string): Promise<GISFeature[]> {
    const url = "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataPVA/MapServer/1/query";
    const where = `PARCELID = '${parcelId}'`;
    return this.queryArcGIS(url, where);
  }

  /**
   * Consulta el polígono catastral de Jefferson County (LOJIC OpenData PVA) por ID de parcela.
   */
  async queryJeffersonParcelPolygon(parcelId: string): Promise<GISFeature | null> {
    const url = "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataPVA/MapServer/1/query";
    const params = new URLSearchParams({
      where: `PARCELID = '${parcelId}'`,
      outFields: "PARCELID",
      f: "json",
      returnGeometry: "true",
      outSR: "4326"
    });
    const fullUrl = `${url}?${params.toString()}`;
    console.log(`[GIS REST CLIENT] Consultando polígono de parcela: ${fullUrl}`);
    try {
      const response = await makeGotScrapingRequest(fullUrl);
      const data = JSON.parse(response.body) as GISQueryResponse;
      if (data.features && data.features.length > 0) {
        return data.features[0];
      }
    } catch (err: any) {
      console.error(`[GIS REST CLIENT ERROR] Falló la consulta del polígono para ${parcelId}:`, err.message);
    }
    return null;
  }
}
export const gisRestClient = new GISRestClient();

