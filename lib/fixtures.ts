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
];
