import { ColaApplication } from "@/lib/contract";

/**
 * Single source of truth for the real COLA sample applications, transcribed
 * from the public registry PDFs in the repo root. Consumed by the UI sample
 * loader, proof-of-life/smoke scripts, the eval golden set (a unit test
 * asserts eval/golden.json matches these), and the batch "include real
 * examples" mix. Edit here, nowhere else.
 */

/** LabelExample1.pdf — TTB ID 10200001000187 (approved wine COLA). */
export const OTIUM_APPLICATION: ColaApplication = {
  serialNumber: "100002",
  beverageType: "wine",
  sourceOfProduct: "domestic",
  brandName: "OTIUM CELLARS",
  classType: "Pinot Gris",
  alcoholContent: "12",
  netContents: "750 MILLILITERS",
  applicantNameAddress:
    "EIGHT CHAINS NORTH, FURNACE MOUNTAIN VINEYARDS LLC, 38593 DAYMONT LN, WATERFORD VA 20197, OTIUM CELLARS",
  wineAppellation: "LOUDOUN COUNTY VIRGINIA",
  wineVintage: "2009",
};

/** OTIUM TTB ID, used by the COLA prefill demo chip. */
export const OTIUM_TTB_ID = "10200001000187";

/** LabelExample2.pdf — TTB ID 10309001000319 (approved spirits COLA). */
export const SANTA_FE_APPLICATION: ColaApplication = {
  serialNumber: "100010",
  beverageType: "distilled_spirits",
  sourceOfProduct: "domestic",
  brandName: "SANTA FE SPIRITS",
  classType: "Straight Malt Whiskey",
  alcoholContent: "46%",
  netContents: "750 MILLILITERS",
  applicantNameAddress:
    "SANTA FE DISTILLERY, L.L.C., 7505 MALLARD WAY UNIT 1, SANTA FE NM 87506, SANTA FE SPIRITS",
};

/** LabelExample3.pdf — TTB ID 10200001000173 (approved wine COLA, fanciful name). */
export const EIGHT_CHAINS_APPLICATION: ColaApplication = {
  serialNumber: "100001",
  beverageType: "wine",
  sourceOfProduct: "domestic",
  brandName: "8 CHAINS NORTH",
  fancifulName: "RESERVE FURNACE MOUNTAIN RED",
  classType: "TABLE RED WINE",
  alcoholContent: "13.5",
  netContents: "750 MILLILITERS",
  applicantNameAddress:
    "EIGHT CHAINS NORTH, FURNACE MOUNTAIN VINEYARDS LLC, 38593 DAYMONT LN, WATERFORD VA 20197",
  wineAppellation: "LOUDOUN COUNTY VIRGINIA",
  wineVintage: "2008",
};

/** LabelExample4.pdf — imported Italian red wine COLA. */
export const VALOROSO_TOSCANO_APPLICATION: ColaApplication = {
  serialNumber: "11102001000243",
  beverageType: "wine",
  sourceOfProduct: "imported",
  brandName: "VALOROSO TOSCANO",
  fancifulName: "RED WINE",
  classType: "TABLE RED WINE",
  alcoholContent: "12%",
  netContents: "5 LITERS",
  applicantNameAddress: "BANFI VINTNERS OLD BROOKVILLE, NY",
  countryOfOrigin: "ITALY",
  wineAppellation: "MONTEPULCIANO D'ABRUZZO",
};

/** LabelExample5.pdf — imported Chilean Syrah COLA. */
export const NATURA_SYRAH_APPLICATION: ColaApplication = {
  serialNumber: "09062001000064",
  beverageType: "wine",
  sourceOfProduct: "imported",
  brandName: "NATURA",
  fancifulName: "SYRAH",
  classType: "TABLE RED WINE",
  alcoholContent: "14% ALC. BY VOL.",
  netContents: "750 ML",
  applicantNameAddress: "BANFI PRODUCTS CORPORATION, 1111 CEDAR SWAMP ROAD, OLD BROOKVILLE, NY 11545",
  countryOfOrigin: "CHILE",
  wineAppellation: "VALLE DEL RAPEL",
  wineVintage: "2010",
};

/** LabelExample6.pdf — domestic flavored wine cocktail COLA. */
export const CORDINA_DAIQ_GO_RI_APPLICATION: ColaApplication = {
  serialNumber: "1400000100045",
  beverageType: "wine",
  sourceOfProduct: "domestic",
  brandName: "Cordina",
  fancifulName: "daiq-GO-ri",
  classType: "table flavored wine",
  alcoholContent: "6% Alc/Vol",
  netContents: "375 ml (12.7 fl oz)",
  applicantNameAddress: "E&J Gallo Winery, 600 Yosemite Blvd., Modesto, CA 95354",
  countryOfOrigin: "United States",
};

/** LabelExample7.pdf — imported Italian Pinot Grigio COLA. */
export const SOGNO_DITALIA_APPLICATION: ColaApplication = {
  serialNumber: "11177001000105",
  beverageType: "wine",
  sourceOfProduct: "imported",
  brandName: "Sogno d'Italia",
  fancifulName: "Dream of Italy",
  classType: "TABLE WHITE WINE",
  alcoholContent: "12%",
  netContents: "750 ML",
  applicantNameAddress: "Banfi Vintners, Old Brookville, NY 11545",
  countryOfOrigin: "Italy",
  wineAppellation: "Toscana",
  wineVintage: "2010",
  grapeVarietals: "Pinot Grigio",
};

/** LabelExample8.pdf — domestic apple brandy COLA. */
export const SANTA_FE_APPLE_BRANDY_APPLICATION: ColaApplication = {
  serialNumber: "20191001000123",
  beverageType: "distilled_spirits",
  sourceOfProduct: "domestic",
  brandName: "Santa Fe Spirits",
  fancifulName: "Apple Brandy",
  classType: "Apple Brandy",
  alcoholContent: "40% Alc/Vol",
  netContents: "750 mL",
  applicantNameAddress: "Santa Fe Spirits, LLC, 7505 Mallard Way, Santa Fe, NM 87507",
  countryOfOrigin: "United States",
};

/** LabelExample9.pdf — domestic moonshine COLA. */
export const HOWLING_MOON_APPLICATION: ColaApplication = {
  serialNumber: "11322001000260",
  beverageType: "distilled_spirits",
  sourceOfProduct: "domestic",
  brandName: "Howling Moon",
  fancifulName: "Raymond Fairchild's Mountain Moonshine",
  classType: "Moonshine",
  alcoholContent: "35%",
  netContents: "750 ML",
  applicantNameAddress: "The Copper Still LLC, 1065 Tunnel Road, Building 2, Asheville, NC 28805",
  countryOfOrigin: "United States",
};

export interface RealExample {
  id: string;
  application: ColaApplication;
  /** Label image filenames under eval/images/ (servable copies in public/samples/). */
  images: string[];
}

export const REAL_EXAMPLES: RealExample[] = [
  {
    id: "real-otium",
    application: OTIUM_APPLICATION,
    images: ["labelexample1_p2_0.jpg", "labelexample1_p3_1.jpg"],
  },
  {
    id: "real-santa-fe",
    application: SANTA_FE_APPLICATION,
    images: ["labelexample2_p2_0.jpg"],
  },
  {
    id: "real-eight-chains",
    application: EIGHT_CHAINS_APPLICATION,
    images: ["labelexample3_p2_0.jpg"],
  },
  {
    id: "real-valoroso-toscano",
    application: VALOROSO_TOSCANO_APPLICATION,
    images: ["labelexample4_p2_0.jpg", "labelexample4_p3_1.jpg"],
  },
  {
    id: "real-natura-syrah",
    application: NATURA_SYRAH_APPLICATION,
    images: ["labelexample5_p2_0.jpg", "labelexample5_p3_1.jpg"],
  },
  {
    id: "real-cordina-daiq-go-ri",
    application: CORDINA_DAIQ_GO_RI_APPLICATION,
    images: ["labelexample6_p3_0.jpg", "labelexample6_p4_1.jpg"],
  },
  {
    id: "real-sogno-ditalia",
    application: SOGNO_DITALIA_APPLICATION,
    images: ["labelexample7_p2_0.jpg", "labelexample7_p3_1.jpg"],
  },
  {
    id: "real-santa-fe-apple-brandy",
    application: SANTA_FE_APPLE_BRANDY_APPLICATION,
    images: ["labelexample8_p2_0.jpg", "labelexample8_p3_1.jpg"],
  },
  {
    id: "real-howling-moon",
    application: HOWLING_MOON_APPLICATION,
    images: ["labelexample9_p2_0.jpg", "labelexample9_p3_1.jpg"],
  },
];
