import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { ColaApplication } from "@/lib/contract";
import { isPdfDataUrl, isSupportedLabelDataUrl } from "@/lib/labelFiles";

const APPLICATION_PROMPT = `You are a TTB COLA application extraction system. Read uploaded TTB Form 5100.31 / COLA application files and extract the application fields used for label verification.

Rules:
- Extract from the COLA application/certificate/form pages, not from label artwork unless a form field is absent and the label is the only visible source.
- Preserve form wording where practical. Do not normalize company names, addresses, quantities, or class/type text.
- beverageType must be one of: wine, distilled_spirits, malt_beverage.
- sourceOfProduct must be domestic or imported.
- classType is the class/type designation or class/type description on the certificate.
- applicantNameAddress is the applicant/proprietor/bottler name and address as a single comma-separated string.
- alcoholContent and netContents are optional because newer Form 5100.31 editions may omit them. Include them only when the application states them.
- For wine, include wineAppellation, wineVintage, and grapeVarietals only when present on the application.`;

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    client = new OpenAI({ apiKey });
  }
  return client;
}

export class ApplicationExtractionError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

export interface ApplicationExtractionResult {
  application: ColaApplication;
  usage: { inputTokens: number; outputTokens: number };
}

export async function extractApplicationFromFiles(
  fileDataUrls: string | string[]
): Promise<ApplicationExtractionResult> {
  const urls = Array.isArray(fileDataUrls) ? fileDataUrls : [fileDataUrls];
  if (urls.length === 0) throw new ApplicationExtractionError("No application files provided");
  if (!urls.every(isSupportedLabelDataUrl)) {
    throw new ApplicationExtractionError("Only PDF or image data URLs are supported for application extraction");
  }

  let completion: OpenAI.Chat.Completions.ChatCompletion;
  try {
    completion = await getClient().chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      max_tokens: 1200,
      messages: [
        { role: "system", content: APPLICATION_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract the COLA application fields from ${urls.length} uploaded file(s).`,
            },
            ...urls.map(applicationPart),
          ],
        },
      ],
      response_format: zodResponseFormat(ColaApplication, "cola_application"),
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      const status = typeof err.status === "number" ? err.status : undefined;
      const transient =
        err instanceof OpenAI.APIConnectionError ||
        status === 429 ||
        (status !== undefined && status >= 500);
      throw new ApplicationExtractionError(`Application extraction request failed: ${err.message}`, transient);
    }
    throw new ApplicationExtractionError(
      err instanceof Error ? err.message : "Application extraction request failed",
      false
    );
  }

  return finishExtraction(completion);
}

export async function extractApplicationFromPdf(
  fileDataUrls: string | string[]
): Promise<ApplicationExtractionResult> {
  return extractApplicationFromFiles(fileDataUrls);
}

function applicationPart(url: string, index: number): ChatCompletionContentPart {
  if (!isPdfDataUrl(url)) {
    return {
      type: "image_url",
      image_url: { url, detail: "high" },
    };
  }
  return {
    type: "file",
    file: {
      filename: `application-${index + 1}.pdf`,
      file_data: url,
    },
  };
}

function finishExtraction(
  completion: OpenAI.Chat.Completions.ChatCompletion
): ApplicationExtractionResult {
  const choice = completion.choices[0];
  if (!choice) throw new ApplicationExtractionError("Model returned no choices");
  if (choice.finish_reason === "length") {
    throw new ApplicationExtractionError("Model output was truncated");
  }
  if (choice.message.refusal) {
    throw new ApplicationExtractionError(`Model refused: ${choice.message.refusal}`);
  }
  const raw = choice.message.content;
  if (!raw) throw new ApplicationExtractionError("Model returned empty content");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApplicationExtractionError("Model output was not valid JSON");
  }
  const result = ColaApplication.safeParse(parsed);
  if (!result.success) {
    throw new ApplicationExtractionError(`Model output violated the contract: ${result.error.message}`);
  }
  return {
    application: scrubOptionalBlanks(result.data),
    usage: {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}

function optional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? value : undefined;
}

function scrubOptionalBlanks(application: ColaApplication): ColaApplication {
  return {
    ...application,
    fancifulName: optional(application.fancifulName),
    alcoholContent: optional(application.alcoholContent),
    netContents: optional(application.netContents),
    countryOfOrigin: optional(application.countryOfOrigin),
    wineAppellation: optional(application.wineAppellation),
    wineVintage: optional(application.wineVintage),
    grapeVarietals: optional(application.grapeVarietals),
  };
}
