import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, anthropic, costUsd } from "./claude";
import { extractionSchema, type ExtractionOutput } from "./schemas";

const SYSTEM = `You extract reported figures from SEO/marketing report PDFs for human review.
- Extract only figures that are actually printed in the document; never infer or compute values.
- Keep the original label and the value exactly as written (value_text). Fill "value" only when it is a single plain number.
- Map to normalized_metric only when the label clearly means that metric; otherwise use "other".
- Set confidence low for blurry, image-only or ambiguous figures.
- If the document says its figures are placeholders, samples or illustrative, say so in notes.
- Dates: only if the document states the reporting period.`;

/** Claude reads the PDF directly (text and image-only pages). Output is schema-validated. */
export async function extractReport(pdf: Buffer): Promise<{ out: ExtractionOutput; usage: { input_tokens: number; output_tokens: number; cost_usd: number } }> {
  const response = await anthropic().beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: "medium", format: betaZodOutputFormat(extractionSchema) },
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
        { type: "text", text: "Extract every reported metric from this report for review." },
      ],
    }],
  });
  if (response.stop_reason === "refusal") throw new Error("The AI declined to read this document.");
  if (response.stop_reason === "max_tokens") throw new Error("The report is too large to extract in one pass.");
  if (!response.parsed_output) throw new Error("The extraction didn't match the expected structure.");
  const u = response.usage;
  return { out: response.parsed_output, usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cost_usd: costUsd(u) } };
}
