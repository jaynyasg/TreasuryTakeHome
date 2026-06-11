import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { ExtractedLabel } from "@/lib/contract";
import { isPdfDataUrl, isSupportedLabelDataUrl } from "@/lib/labelFiles";

/**
 * The LLM seam. The model is an adversary: its output is parsed against the
 * contract schema, and any shape drift / refusal / truncation becomes a
 * thrown error here — never an unvalidated object flowing inward.
 */

const EXTRACTION_PROMPT = `You are a TTB label compliance extraction system. Read the alcohol beverage label image and extract exactly what is printed on it.

Rules:
- Transcribe verbatim. Do NOT correct, complete, or normalize what the label says.
- For PDFs, ignore COLA application/form/registry pages and extract only from actual product label artwork or container label pages.
- Use null for any field not visible on the label. NEVER use placeholder text like ".", "-", "N/A", or "none" — null only.
- classType: the class/type designation — the product style or varietal, e.g. "Kentucky Straight Bourbon Whiskey", "Pinot Gris", "India Pale Ale". A grape varietal on a wine label IS the class/type.
- fancifulName: a distinctive coined product name that is neither the brand nor the class/type (e.g. "RESERVE FURNACE MOUNTAIN RED"). Most labels have none — null is the common answer.
- alcoholContent: the alcohol statement as printed, e.g. "45% Alc./Vol. (90 Proof)" or "12% ALC/VOL".
- netContents: as printed, e.g. "750 mL".
- governmentWarning.text: the COMPLETE warning statement verbatim, including its heading, preserving the exact capitalization printed on the label.
- governmentWarning.headingStyle: "all_caps" only if the "GOVERNMENT WARNING:" lead-in is printed entirely in capital letters; "title_case" if written like "Government Warning:"; otherwise "other".
- readability: "clear" if you can read the whole label confidently; "partial" if glare/angle/blur makes some regions uncertain; "unreadable" if most of it cannot be read.
- HONESTY OVER COMPLETENESS: if blur, glare, rotation, perspective, or shadow leaves you less than certain of the EXACT characters in a field (especially numbers like alcohol % and net contents), set that field to null and readability to "partial" — NEVER guess. A guessed number presented as fact is the worst possible output; a null with readability "partial" is the correct answer for an unreadable region.`;

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    client = new OpenAI({ apiKey });
  }
  return client;
}

export class ExtractionError extends Error {
  /** Transient upstream failure (429/5xx/timeout/network) — retry may succeed. */
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

export interface ExtractionResult {
  label: ExtractedLabel;
  /** Token usage for measured cost estimates. */
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Extract label fields from a label set (one or more label files — front,
 * back, neck, or PDF pages — treated as a single label). Accepts image data
 * URLs, PDF data URLs, or https image URLs.
 * Throws ExtractionError on refusal, truncation, or contract violation.
 */
export async function extractLabel(imageUrls: string | string[]): Promise<ExtractionResult> {
  const urls = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
  if (urls.length === 0) throw new ExtractionError("No label files provided");
  if (!urls.every(isSupportedModelInputUrl)) {
    throw new ExtractionError("Only image URLs and PDF data URLs are supported for label extraction");
  }
  let completion: OpenAI.Chat.Completions.ChatCompletion;
  try {
    completion = await createCompletion(urls);
  } catch (err) {
    // Classify upstream failures: 429/5xx/connection problems are transient
    // (retryable); everything else is a hard failure.
    if (err instanceof OpenAI.APIError) {
      const status = typeof err.status === "number" ? err.status : undefined;
      const transient =
        err instanceof OpenAI.APIConnectionError ||
        status === 429 ||
        (status !== undefined && status >= 500);
      throw new ExtractionError(`Vision model request failed: ${err.message}`, transient);
    }
    throw new ExtractionError(
      err instanceof Error ? err.message : "Vision model request failed",
      false
    );
  }
  return finishExtraction(completion);
}

function createCompletion(urls: string[]): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const content: ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `Extract the label fields from this label set (${urls.length} file(s) for the same container — e.g. front label, back label, neck label, or a label PDF).`,
    },
    ...urls.map(labelInputPart),
  ];

  return getClient().chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    max_tokens: 1500,
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      {
        role: "user",
        content,
      },
    ],
    response_format: zodResponseFormat(ExtractedLabel, "extracted_label"),
  });
}

function isSupportedModelInputUrl(url: string): boolean {
  return isSupportedLabelDataUrl(url) || /^https:\/\//i.test(url);
}

function labelInputPart(url: string, index: number): ChatCompletionContentPart {
  if (isPdfDataUrl(url)) {
    return {
      type: "file",
      file: {
        filename: `label-${index + 1}.pdf`,
        file_data: url,
      },
    };
  }
  return {
    type: "image_url",
    image_url: { url, detail: "high" },
  };
}

function finishExtraction(
  completion: OpenAI.Chat.Completions.ChatCompletion
): ExtractionResult {
  const choice = completion.choices[0];
  if (!choice) throw new ExtractionError("Model returned no choices");
  if (choice.finish_reason === "length") {
    throw new ExtractionError("Model output was truncated");
  }
  if (choice.message.refusal) {
    throw new ExtractionError(`Model refused: ${choice.message.refusal}`);
  }
  const raw = choice.message.content;
  if (!raw) throw new ExtractionError("Model returned empty content");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ExtractionError("Model output was not valid JSON");
  }
  const result = ExtractedLabel.safeParse(parsed);
  if (!result.success) {
    throw new ExtractionError(`Model output violated the contract: ${result.error.message}`);
  }
  return {
    label: repairReadability(scrubPlaceholders(result.data)),
    usage: {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Consistency repair: a null MANDATORY field together with readability "clear"
 * is self-contradictory (the null is an admission something couldn't be read).
 * Downgrade to "partial" so downstream verdicts become needs_review instead of
 * a confident missing_on_label. Optional fields (fanciful name, appellation,
 * vintage, origin) are legitimately null and don't trigger this.
 */
function repairReadability(label: ExtractedLabel): ExtractedLabel {
  if (label.readability !== "clear") return label;
  const mandatoryNull =
    label.brandName === null ||
    label.alcoholContent === null ||
    label.netContents === null ||
    (label.governmentWarning.present && label.governmentWarning.text === null);
  return mandatoryNull ? { ...label, readability: "partial" } : label;
}

const PLACEHOLDERS = new Set(["", ".", "-", "n/a", "na", "none", "null", "not visible", "not present"]);

function nullIfPlaceholder(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  // Known placeholder words, or any value with no letters/digits at all
  // (models emit ".", ":", "—" etc. for unreadable regions despite instructions).
  if (PLACEHOLDERS.has(trimmed.toLowerCase()) || !/[\p{L}\p{N}]/u.test(trimmed)) {
    return null;
  }
  return value;
}

/** Models sometimes emit "." or "N/A" instead of null despite instructions. */
function scrubPlaceholders(label: ExtractedLabel): ExtractedLabel {
  return {
    ...label,
    brandName: nullIfPlaceholder(label.brandName),
    fancifulName: nullIfPlaceholder(label.fancifulName),
    classType: nullIfPlaceholder(label.classType),
    alcoholContent: nullIfPlaceholder(label.alcoholContent),
    netContents: nullIfPlaceholder(label.netContents),
    producerNameAddress: nullIfPlaceholder(label.producerNameAddress),
    countryOfOrigin: nullIfPlaceholder(label.countryOfOrigin),
    wineAppellation: nullIfPlaceholder(label.wineAppellation),
    wineVintage: nullIfPlaceholder(label.wineVintage),
    governmentWarning: {
      ...label.governmentWarning,
      text: nullIfPlaceholder(label.governmentWarning.text),
    },
  };
}
