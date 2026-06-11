"use client";

import { BeverageType, ColaApplication } from "@/lib/contract";

const INPUT =
  "h-9 w-full rounded-lg border border-line bg-card px-2.5 text-[13px] text-ink " +
  "placeholder:text-muted-2 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20 transition";

function Field({
  label,
  children,
  span2 = false,
}: {
  label: string;
  children: React.ReactNode;
  span2?: boolean;
}) {
  return (
    <label className={"block " + (span2 ? "sm:col-span-2" : "")}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

export default function ApplicationForm({
  value,
  onChange,
}: {
  value: ColaApplication;
  onChange: (next: ColaApplication) => void;
}) {
  const set = <K extends keyof ColaApplication>(key: K, v: ColaApplication[K]) =>
    onChange({ ...value, [key]: v });
  const isWine = value.beverageType === "wine";
  const isImported = value.sourceOfProduct === "imported";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Type of product">
        <select
          className={INPUT}
          value={value.beverageType}
          onChange={(e) => set("beverageType", e.target.value as BeverageType)}
        >
          <option value="wine">Wine</option>
          <option value="distilled_spirits">Distilled spirits</option>
          <option value="malt_beverage">Malt beverage</option>
        </select>
      </Field>
      <Field label="Source">
        <select
          className={INPUT}
          value={value.sourceOfProduct}
          onChange={(e) => set("sourceOfProduct", e.target.value as "domestic" | "imported")}
        >
          <option value="domestic">Domestic</option>
          <option value="imported">Imported</option>
        </select>
      </Field>
      <Field label="Brand name">
        <input className={INPUT} value={value.brandName} onChange={(e) => set("brandName", e.target.value)} placeholder="OLD TOM DISTILLERY" />
      </Field>
      <Field label="Fanciful name (if any)">
        <input
          className={INPUT}
          value={value.fancifulName ?? ""}
          onChange={(e) => set("fancifulName", e.target.value || undefined)}
          placeholder="—"
        />
      </Field>
      <Field label="Class / type">
        <input className={INPUT} value={value.classType} onChange={(e) => set("classType", e.target.value)} placeholder="Kentucky Straight Bourbon Whiskey" />
      </Field>
      <Field label="Serial number">
        <input className={INPUT} value={value.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} placeholder="100002" />
      </Field>
      <Field label="Alcohol content (2023 forms omit)">
        <input
          className={INPUT}
          value={value.alcoholContent ?? ""}
          onChange={(e) => set("alcoholContent", e.target.value || undefined)}
          placeholder="45% Alc./Vol. (90 Proof) — blank: verify presence only"
        />
      </Field>
      <Field label="Net contents (2023 forms omit)">
        <input
          className={INPUT}
          value={value.netContents ?? ""}
          onChange={(e) => set("netContents", e.target.value || undefined)}
          placeholder="750 MILLILITERS — blank: verify presence only"
        />
      </Field>
      <Field label="Applicant name & address (as on permit)" span2>
        <input className={INPUT} value={value.applicantNameAddress} onChange={(e) => set("applicantNameAddress", e.target.value)} placeholder="OLD TOM DISTILLERY, 100 MAIN ST, LOUISVILLE KY 40202" />
      </Field>
      {isImported && (
        <Field label="Country of origin" span2>
          <input className={INPUT} value={value.countryOfOrigin ?? ""} onChange={(e) => set("countryOfOrigin", e.target.value || undefined)} placeholder="PRODUCT OF FRANCE" />
        </Field>
      )}
      {isWine && (
        <>
          <Field label="Grape varietal(s) (2023 forms, if on label)">
            <input
              className={INPUT}
              value={value.grapeVarietals ?? ""}
              onChange={(e) => set("grapeVarietals", e.target.value || undefined)}
              placeholder="Pinot Gris"
            />
          </Field>
          <Field label="Appellation (if on label)">
            <input className={INPUT} value={value.wineAppellation ?? ""} onChange={(e) => set("wineAppellation", e.target.value || undefined)} placeholder="LOUDOUN COUNTY VIRGINIA" />
          </Field>
          <Field label="Vintage (if on label)">
            <input className={INPUT} value={value.wineVintage ?? ""} onChange={(e) => set("wineVintage", e.target.value || undefined)} placeholder="2009" />
          </Field>
        </>
      )}
    </div>
  );
}
