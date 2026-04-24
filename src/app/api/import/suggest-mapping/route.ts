/**
 * AI-assisted column mapping.
 *
 * Given a spreadsheet's headers and a small sample of rows, returns a
 * suggested mapping from each source column to a DueDateHQ field, plus
 * any entity-type value normalizations.
 *
 * Uses Vercel AI Gateway (routes via `anthropic/claude-haiku-4.5`).
 * Falls back to heuristic matching if the AI call fails — never blocks
 * the user's import.
 *
 * Auth: Clerk-gated via proxy.ts (this route is NOT on the public allowlist).
 */

import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { auth } from "@clerk/nextjs/server";
import {
  DUEDATE_FIELDS,
  MappingSuggestionSchema,
  type CellValue,
} from "@/lib/import/types";
import { suggestMappingHeuristic } from "@/lib/import/mapping";

export const maxDuration = 30; // keep AI calls snappy

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.headers)) {
    return NextResponse.json(
      { error: "Invalid payload — expected { headers: string[], sample: object[] }" },
      { status: 400 },
    );
  }

  const headers: string[] = body.headers;
  const sample: Array<Record<string, CellValue>> = (body.sample ?? []).slice(0, 5);

  // Heuristic fallback — always compute so we have something to return on AI failure
  const heuristicMapping = suggestMappingHeuristic(headers);

  try {
    const { experimental_output: output } = await generateText({
      model: "anthropic/claude-haiku-4.5",
      experimental_output: Output.object({ schema: MappingSuggestionSchema }),
      prompt: buildPrompt(headers, sample),
    });

    // Post-validate: ensure every header is covered + targetField is valid
    const covered = new Set(output.mappings.map((m) => m.sourceColumn));
    for (const h of headers) {
      if (!covered.has(h)) {
        output.mappings.push({
          sourceColumn: h,
          targetField: heuristicMapping[h] ?? "ignore",
          confidence: "low",
          reasoning: "AI omitted; filled from heuristic",
        });
      }
    }

    return NextResponse.json({
      source: "ai",
      suggestion: output,
      heuristic: heuristicMapping,
    });
  } catch (err) {
    console.warn("[import/suggest-mapping] AI fallback triggered:", err);
    // Return heuristic as a well-formed suggestion
    return NextResponse.json({
      source: "heuristic",
      suggestion: {
        mappings: Object.entries(heuristicMapping).map(([k, v]) => ({
          sourceColumn: k,
          targetField: v,
          confidence: "low" as const,
          reasoning: "Heuristic (AI unavailable)",
        })),
      },
      heuristic: heuristicMapping,
    });
  }
}

function buildPrompt(
  headers: string[],
  sample: Array<Record<string, CellValue>>,
): string {
  return [
    "You are helping a US CPA migrate their client list into DueDateHQ.",
    "Map each source spreadsheet column to the most appropriate DueDateHQ field.",
    "If a column is irrelevant (IDs, internal notes, task status, dates, etc.), map it to 'ignore'.",
    "",
    "Available DueDateHQ fields:",
    ...DUEDATE_FIELDS.map((f) => `- ${f}`),
    "",
    "Rules:",
    "- Every source column must appear in `mappings` exactly once.",
    "- Use 'ignore' if you're unsure or the column is clearly irrelevant.",
    "- For `entityType` columns, also populate `entityTypeNormalization` by",
    "  mapping each unique source value to our enum (individual/c_corp/s_corp/",
    "  partnership/llc/trust/estate/nonprofit), or null if unrecognizable.",
    "- `confidence` reflects your certainty: 'high' for unambiguous matches,",
    "  'medium' for plausible but alias-based, 'low' for guesses.",
    "",
    "SOURCE COLUMNS:",
    ...headers.map((h) => `- "${h}"`),
    "",
    "SAMPLE ROWS (first 5, field values quoted):",
    ...sample.map((row, i) => {
      const cells = headers
        .map((h) => `${h}="${row[h] ?? ""}"`)
        .join(", ");
      return `Row ${i + 1}: ${cells}`;
    }),
  ].join("\n");
}
