import {
  BeverageType,
  ColaApplication,
  ExtractedLabel,
  FieldKey,
  GeneratedCase,
  GOVERNMENT_WARNING_BODY,
  GOVERNMENT_WARNING_HEADING,
} from "@/lib/contract";

/** mulberry32 — tiny deterministic PRNG so cases are reproducible by seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ProductPool {
  brands: string[];
  classTypes: string[];
  abvPercents: number[];
}

const POOLS: Record<BeverageType, ProductPool> = {
  distilled_spirits: {
    brands: ["OLD TOM DISTILLERY", "STONE'S THROW", "COPPER CANYON", "SILVER BIRCH SPIRITS"],
    classTypes: [
      "Kentucky Straight Bourbon Whiskey",
      "Single Malt Whiskey",
      "London Dry Gin",
      "Silver Rum",
    ],
    abvPercents: [40, 43, 45, 46, 50],
  },
  wine: {
    brands: ["OTIUM CELLARS", "8 CHAINS NORTH", "WILLOW BEND VINEYARDS", "RED GATE WINERY"],
    classTypes: ["Table White Wine", "Table Red Wine", "Pinot Gris", "Cabernet Sauvignon"],
    abvPercents: [11.5, 12, 12.5, 13.5, 14.1],
  },
  malt_beverage: {
    brands: ["IRON ANCHOR BREWING", "BLUE HERON ALES", "GRANITE PEAK BREWERY", "FOUNDRY & OAK"],
    classTypes: ["India Pale Ale", "Stout", "Amber Lager", "Hefeweizen"],
    abvPercents: [4.5, 5, 5.6, 6.8, 8],
  },
};

const CITIES = [
  ["LOUISVILLE", "KY", "40202"],
  ["WATERFORD", "VA", "20197"],
  ["SANTA FE", "NM", "87506"],
  ["PORTLAND", "OR", "97209"],
  ["AUSTIN", "TX", "78701"],
] as const;

const NET_CONTENTS: Array<[string, string]> = [
  // [application form value, label rendering]
  ["750 MILLILITERS", "750 mL"],
  ["375 MILLILITERS", "375 mL"],
  ["1 LITER", "1 L"],
  ["12 FL. OZ.", "12 FL. OZ."],
];

const CLEAN_WARNING = `${GOVERNMENT_WARNING_HEADING} ${GOVERNMENT_WARNING_BODY}`;

/** Defect mutations: each makes the label disagree with the application in a way the engine must flag. */
const DEFECT_FIELDS: FieldKey[] = [
  "brandName",
  "classType",
  "alcoholContent",
  "netContents",
  "governmentWarning",
];

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export interface GenerateOptions {
  /** Number of deliberate label defects to inject (0 = clean pair). */
  defects: number;
  beverageType?: BeverageType;
}

export function generateCase(seed: number, opts: GenerateOptions): GeneratedCase {
  const rng = mulberry32(seed * 2654435761 + 1);
  const beverageType =
    opts.beverageType ?? pick(rng, ["wine", "distilled_spirits", "malt_beverage"] as const);
  const pool = POOLS[beverageType];

  const brand = pick(rng, pool.brands);
  const classType = pick(rng, pool.classTypes);
  const percent = pick(rng, pool.abvPercents);
  const [appNet, labelNet] = pick(rng, NET_CONTENTS);
  const [city, state, zip] = pick(rng, CITIES);
  const street = `${100 + Math.floor(rng() * 900)} ${pick(rng, ["MAIN ST", "OAK AVE", "RIVER RD", "MARKET ST"])}`;
  const isWine = beverageType === "wine";
  const vintage = isWine ? String(2018 + Math.floor(rng() * 7)) : undefined;

  const application: ColaApplication = {
    serialNumber: String(100000 + Math.floor(rng() * 900000)),
    beverageType,
    sourceOfProduct: "domestic",
    brandName: brand,
    classType,
    alcoholContent:
      beverageType === "distilled_spirits"
        ? `${percent}% Alc./Vol. (${percent * 2} Proof)`
        : String(percent),
    netContents: appNet,
    applicantNameAddress: `${brand}, ${street}, ${city} ${state} ${zip}`,
    ...(isWine ? { wineVintage: vintage } : {}),
  };

  const label: ExtractedLabel = {
    brandName: brand,
    fancifulName: null,
    classType,
    alcoholContent:
      beverageType === "distilled_spirits"
        ? `${percent}% Alc./Vol. (${percent * 2} Proof)`
        : `${percent}% ALC./VOL.`,
    netContents: labelNet,
    producerNameAddress: `${brand}, ${city}, ${state}`,
    countryOfOrigin: null,
    wineAppellation: null,
    wineVintage: vintage ?? null,
    governmentWarning: { present: true, text: CLEAN_WARNING, headingStyle: "all_caps" },
    readability: "clear",
  };

  const injectedDefects: GeneratedCase["injectedDefects"] = [];
  const defectFields = [...DEFECT_FIELDS];
  for (let i = 0; i < Math.min(opts.defects, defectFields.length); i++) {
    const field = defectFields.splice(Math.floor(rng() * defectFields.length), 1)[0];
    switch (field) {
      case "brandName": {
        const other = pool.brands.find((b) => b !== brand)!;
        label.brandName = other;
        injectedDefects.push({ field, description: `Label brand "${other}" differs from application "${brand}".` });
        break;
      }
      case "classType": {
        const other = pool.classTypes.find((c) => c !== classType)!;
        label.classType = other;
        injectedDefects.push({ field, description: `Label class/type "${other}" differs from "${classType}".` });
        break;
      }
      case "alcoholContent": {
        const wrong = percent + (percent >= 20 ? 5 : 1.5);
        label.alcoholContent = `${wrong}% ALC./VOL.`;
        injectedDefects.push({ field, description: `Label shows ${wrong}% instead of ${percent}%.` });
        break;
      }
      case "netContents": {
        const [, otherLabel] = NET_CONTENTS.find(([a]) => a !== appNet)!;
        label.netContents = otherLabel;
        injectedDefects.push({ field, description: `Label net contents "${otherLabel}" differs from "${appNet}".` });
        break;
      }
      case "governmentWarning": {
        const variant = Math.floor(rng() * 3);
        if (variant === 0) {
          label.governmentWarning = { present: false, text: null, headingStyle: null };
          injectedDefects.push({ field, description: "Government warning omitted entirely." });
        } else if (variant === 1) {
          label.governmentWarning = {
            present: true,
            text: `Government Warning: ${GOVERNMENT_WARNING_BODY}`,
            headingStyle: "title_case",
          };
          injectedDefects.push({ field, description: "Warning heading in title case instead of all caps." });
        } else {
          label.governmentWarning = {
            present: true,
            text: `${GOVERNMENT_WARNING_HEADING} (1) Per the Surgeon General, pregnant women should not drink alcohol. (2) Alcohol impairs driving and may cause health problems.`,
            headingStyle: "all_caps",
          };
          injectedDefects.push({ field, description: "Warning body reworded (not the mandatory text)." });
        }
        break;
      }
      default:
        break;
    }
  }

  return { application, label, injectedDefects };
}
