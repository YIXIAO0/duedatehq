"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  FileSpreadsheet,
  ClipboardPaste,
  Download,
  Sparkles,
  Upload,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
} from "lucide-react";
import { parseFile, parsePasteText, extractSampleForSuggestion } from "@/lib/import/parse";
import { buildRowPreviews, suggestMappingHeuristic } from "@/lib/import/mapping";
import { FILE_IN_TIME_MAPPING } from "@/lib/import/file-in-time";
import {
  DUEDATE_FIELDS,
  type ApplyImportInput,
  type ApplyImportResult,
  type ColumnMapping,
  type DueDateField,
  type ParsedSheet,
  type RowPreview,
} from "@/lib/import/types";
import { applyImportAction } from "./actions";

type Step = "upload" | "mapping" | "preview" | "result";
type UploadTab = "file" | "paste";

const FIELD_LABELS: Record<DueDateField, string> = {
  clientName: "Client name",
  entityName: "Entity name",
  entityType: "Entity type",
  homeState: "Home state",
  operatingStates: "Operating states",
  ein: "EIN / Tax ID",
  contactEmail: "Contact email",
  contactPhone: "Contact phone",
  notes: "Notes",
  ignore: "— Skip —",
};

export function ImportWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [aiSource, setAiSource] = useState<"ai" | "heuristic" | "preset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<RowPreview[]>([]);
  const [result, setResult] = useState<ApplyImportResult | null>(null);
  const [suggesting, startSuggesting] = useTransition();
  const [applying, startApplying] = useTransition();

  // ---- step: upload ------------------------------------------------------

  async function handleFile(file: File) {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseFile(buf);
      if (parsed.totalRows === 0) {
        setError("That file appears to be empty. Try another one?");
        return;
      }
      await advanceFromParsedSheet(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file");
    }
  }

  async function handlePaste(text: string) {
    setError(null);
    try {
      const parsed = parsePasteText(text);
      if (parsed.totalRows === 0) {
        setError("Couldn't find any rows. Make sure the first line is headers.");
        return;
      }
      await advanceFromParsedSheet(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse paste");
    }
  }

  async function advanceFromParsedSheet(parsed: ParsedSheet) {
    setSheet(parsed);

    // If File In Time preset detected, apply its mapping directly and skip ahead
    if (parsed.detectedPreset === "file-in-time") {
      const fitMapping: ColumnMapping = {};
      for (const header of parsed.headers) {
        fitMapping[header] = FILE_IN_TIME_MAPPING[header] ?? "ignore";
      }
      setMapping(fitMapping);
      setAiSource("preset");
      setPreviews(buildRowPreviews(parsed.rows, fitMapping));
      setStep("mapping");
      return;
    }

    // Otherwise, prime with heuristic, then fetch AI suggestion
    const heuristic = suggestMappingHeuristic(parsed.headers);
    setMapping(heuristic);
    setPreviews(buildRowPreviews(parsed.rows, heuristic));
    setAiSource("heuristic");
    setStep("mapping");

    // Kick off AI suggestion in background
    startSuggesting(async () => {
      try {
        const res = await fetch("/api/import/suggest-mapping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            headers: parsed.headers,
            sample: extractSampleForSuggestion(parsed, 5),
          }),
        });
        if (!res.ok) throw new Error(`Suggest failed: ${res.status}`);
        const data = await res.json();
        if (data.suggestion?.mappings) {
          const aiMapping: ColumnMapping = {};
          for (const m of data.suggestion.mappings as Array<{
            sourceColumn: string;
            targetField: DueDateField;
          }>) {
            aiMapping[m.sourceColumn] = m.targetField;
          }
          // Only override headers where AI gave a non-ignore mapping
          // (preserves user's heuristic fallback for ignored columns)
          const merged: ColumnMapping = { ...heuristic };
          for (const [k, v] of Object.entries(aiMapping)) {
            if (v !== "ignore") merged[k] = v;
          }
          setMapping(merged);
          setPreviews(buildRowPreviews(parsed.rows, merged));
          setAiSource(data.source === "ai" ? "ai" : "heuristic");
        }
      } catch (err) {
        console.warn("AI suggest failed, keeping heuristic:", err);
      }
    });
  }

  // ---- step: mapping -----------------------------------------------------

  function updateMapping(sourceCol: string, targetField: DueDateField) {
    if (!sheet || !mapping) return;
    const next: ColumnMapping = { ...mapping, [sourceCol]: targetField };
    setMapping(next);
    setPreviews(buildRowPreviews(sheet.rows, next));
  }

  // ---- step: preview → apply ---------------------------------------------

  function handleApply() {
    if (!previews.length) return;
    const validRows = previews
      .filter((p) => p.errors.length === 0)
      .map((p) => ({
        clientName: p.mapped.clientName!,
        entityName: p.mapped.entityName,
        entityType: p.mapped.entityType!,
        homeState: p.mapped.homeState,
        operatingStates: p.mapped.operatingStates,
        ein: p.mapped.ein,
        contactEmail: p.mapped.contactEmail,
        contactPhone: p.mapped.contactPhone,
        notes: p.mapped.notes,
      }));

    const payload: ApplyImportInput = { rows: validRows };

    startApplying(async () => {
      try {
        const r = await applyImportAction(payload);
        setResult(r);
        setStep("result");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed");
      }
    });
  }

  // =======================================================================
  // Render
  // =======================================================================

  return (
    <div className="space-y-6">
      <StepIndicator current={step} />

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {step === "upload" ? (
        <UploadStep onFile={handleFile} onPaste={handlePaste} />
      ) : null}

      {step === "mapping" && sheet && mapping ? (
        <MappingStep
          sheet={sheet}
          mapping={mapping}
          previews={previews}
          onMappingChange={updateMapping}
          onBack={() => setStep("upload")}
          onNext={() => setStep("preview")}
          aiSource={aiSource}
          aiPending={suggesting}
        />
      ) : null}

      {step === "preview" && sheet && previews.length > 0 ? (
        <PreviewStep
          previews={previews}
          onBack={() => setStep("mapping")}
          onConfirm={handleApply}
          applying={applying}
        />
      ) : null}

      {step === "result" && result ? (
        <ResultStep
          result={result}
          onViewClients={() => router.push("/clients")}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepIndicator({ current }: { current: Step }) {
  const steps: Array<{ id: Step; label: string }> = [
    { id: "upload", label: "Upload" },
    { id: "mapping", label: "Map columns" },
    { id: "preview", label: "Preview" },
    { id: "result", label: "Done" },
  ];
  const currentIdx = steps.findIndex((s) => s.id === current);

  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => {
        const active = s.id === current;
        const done = i < currentIdx;
        return (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                active
                  ? "bg-primary text-primary-foreground"
                  : done
                  ? "bg-[var(--color-priority-done)] text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? "✓" : i + 1}
            </div>
            <span
              className={
                active
                  ? "font-medium"
                  : done
                  ? "text-muted-foreground"
                  : "text-muted-foreground/60"
              }
            >
              {s.label}
            </span>
            {i < steps.length - 1 ? (
              <div className="mx-2 h-px w-6 bg-border" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function UploadStep({
  onFile,
  onPaste,
}: {
  onFile: (file: File) => void;
  onPaste: (text: string) => void;
}) {
  const [tab, setTab] = useState<UploadTab>("file");
  const [pasteValue, setPasteValue] = useState("");
  const [dragging, setDragging] = useState(false);

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="inline-flex rounded-md border border-border p-1">
        <button
          onClick={() => setTab("file")}
          className={`rounded px-4 py-1.5 text-sm transition ${
            tab === "file"
              ? "bg-background shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Upload className="mr-1.5 inline h-3.5 w-3.5" /> Upload file
        </button>
        <button
          onClick={() => setTab("paste")}
          className={`rounded px-4 py-1.5 text-sm transition ${
            tab === "paste"
              ? "bg-background shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ClipboardPaste className="mr-1.5 inline h-3.5 w-3.5" /> Paste text
        </button>
      </div>

      {tab === "file" ? (
        <Card>
          <CardContent className="pt-6">
            <div
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) onFile(file);
              }}
              className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/20"
              }`}
            >
              <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-medium">Drop your XLSX or CSV here</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  or click to browse · supports File In Time exports,
                  ProConnect / Drake / Lacerte exports, or any custom spreadsheet
                </p>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="absolute h-0 w-0 opacity-0"
                id="file-upload"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  document.getElementById("file-upload")?.click()
                }
              >
                Choose file
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                🔒 Parsed in your browser — nothing uploads until you click Confirm on the next screen.
              </p>
            </div>

            <div className="mt-5 flex justify-center">
              <Link
                href="/api/import/template"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Don&apos;t have a spreadsheet? Download our template
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Paste your client list</CardTitle>
            <CardDescription>
              First line = column headers. Commas or tabs both work.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={10}
              className="font-mono text-xs"
              placeholder={`Client Name,Entity Type,Home State,EIN
John Smith,Individual,NY,
Acme LLC,LLC,DE,12-3456789
Chen Trust,Trust,CA,`}
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
            />
            <div className="mt-4 flex justify-end">
              <Button
                disabled={!pasteValue.trim()}
                onClick={() => onPaste(pasteValue)}
              >
                Parse & continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MappingStep({
  sheet,
  mapping,
  previews,
  onMappingChange,
  onBack,
  onNext,
  aiSource,
  aiPending,
}: {
  sheet: ParsedSheet;
  mapping: ColumnMapping;
  previews: RowPreview[];
  onMappingChange: (sourceCol: string, targetField: DueDateField) => void;
  onBack: () => void;
  onNext: () => void;
  aiSource: "ai" | "heuristic" | "preset" | null;
  aiPending: boolean;
}) {
  const totalErrors = previews.filter((p) => p.errors.length > 0).length;
  const totalWarnings = previews.filter((p) => p.warnings.length > 0).length;
  const previewRows = previews.slice(0, 5);

  return (
    <div className="space-y-5">
      {/* AI source badge */}
      {aiPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Asking AI to suggest mappings…
        </div>
      ) : aiSource === "preset" ? (
        <Badge className="bg-[var(--color-priority-done-bg)] text-[var(--color-priority-done)] hover:bg-[var(--color-priority-done-bg)]">
          ✨ File In Time export detected — mapping applied automatically
        </Badge>
      ) : aiSource === "ai" ? (
        <Badge variant="secondary">
          <Sparkles className="mr-1 h-3 w-3" /> AI-suggested mapping — review below
        </Badge>
      ) : (
        <Badge variant="outline">Heuristic mapping — review below</Badge>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Map columns to DueDateHQ fields</CardTitle>
          <CardDescription>
            {sheet.totalRows} rows · {sheet.headers.length} columns detected
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {sheet.headers.map((header) => (
              <div key={header} className="flex items-center gap-3">
                <div className="flex-1 truncate font-mono text-xs text-muted-foreground">
                  {header}
                </div>
                <div className="text-muted-foreground">→</div>
                <Select
                  value={mapping[header] ?? "ignore"}
                  onValueChange={(v) =>
                    onMappingChange(header, v as DueDateField)
                  }
                >
                  <SelectTrigger className="w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DUEDATE_FIELDS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {FIELD_LABELS[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Preview first 5 rows */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview — first 5 rows</CardTitle>
          <CardDescription>
            Here&apos;s what those rows look like after mapping. Fix the mapping
            above if something looks off.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border rounded-md border border-border">
            {previewRows.map((p) => (
              <div key={p.index} className="px-4 py-3 text-sm">
                <div className="font-medium">
                  {p.mapped.clientName ?? "⚠ missing name"}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{p.mapped.entityType ?? "?"}</span>
                  {p.mapped.homeState ? <span>· {p.mapped.homeState}</span> : null}
                  {p.mapped.operatingStates?.length ? (
                    <span>· +{p.mapped.operatingStates.length} states</span>
                  ) : null}
                  {p.mapped.contactEmail ? <span>· {p.mapped.contactEmail}</span> : null}
                </div>
                {p.warnings.map((w, i) => (
                  <div key={i} className="mt-1 text-xs text-[var(--color-priority-medium)]">
                    ⚠ {w}
                  </div>
                ))}
                {p.errors.map((e, i) => (
                  <div key={i} className="mt-1 text-xs text-destructive">
                    ✕ {e}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground">
          {totalErrors > 0 ? (
            <span className="text-destructive">
              {totalErrors} row{totalErrors === 1 ? "" : "s"} will be skipped
              (missing name)
            </span>
          ) : null}
          {totalErrors > 0 && totalWarnings > 0 ? <span> · </span> : null}
          {totalWarnings > 0 ? (
            <span>
              {totalWarnings} warning{totalWarnings === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onNext}>Continue to preview</Button>
        </div>
      </div>
    </div>
  );
}

function PreviewStep({
  previews,
  onBack,
  onConfirm,
  applying,
}: {
  previews: RowPreview[];
  onBack: () => void;
  onConfirm: () => void;
  applying: boolean;
}) {
  const valid = previews.filter((p) => p.errors.length === 0);
  const errored = previews.filter((p) => p.errors.length > 0);
  const warned = previews.filter((p) => p.warnings.length > 0 && p.errors.length === 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard
          label="Ready to import"
          value={valid.length}
          color="done"
        />
        <StatCard
          label="With warnings"
          value={warned.length}
          color="medium"
          hint="Will still be imported"
        />
        <StatCard
          label="Will be skipped"
          value={errored.length}
          color="urgent"
          hint="Missing required fields"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Final review</CardTitle>
          <CardDescription>
            This creates <strong>{valid.length} clients</strong> +{" "}
            <strong>{valid.length} tax entities</strong>. Each entity&apos;s
            deadlines will be auto-generated for the current and next tax year.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {errored.length > 0 ? (
            <details className="mb-4">
              <summary className="cursor-pointer text-sm font-medium text-destructive">
                {errored.length} rows will be skipped — click to see why
              </summary>
              <ul className="mt-2 space-y-1 pl-4 text-xs text-muted-foreground">
                {errored.slice(0, 20).map((p) => (
                  <li key={p.index}>
                    Row {p.index + 1}: {p.errors.join("; ")}
                  </li>
                ))}
                {errored.length > 20 ? (
                  <li>… and {errored.length - 20} more</li>
                ) : null}
              </ul>
            </details>
          ) : null}

          <div className="max-h-[360px] overflow-auto divide-y divide-border rounded-md border border-border">
            {valid.slice(0, 100).map((p) => (
              <div
                key={p.index}
                className="flex items-center justify-between px-4 py-2 text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium">{p.mapped.clientName}</span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {p.mapped.entityType}
                  </Badge>
                  {p.mapped.homeState ? (
                    <Badge variant="outline" className="text-xs">
                      {p.mapped.homeState}
                    </Badge>
                  ) : null}
                </div>
                {p.warnings.length > 0 ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-priority-medium)]" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-priority-done)]" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onBack} disabled={applying}>
          Back
        </Button>
        <Button onClick={onConfirm} disabled={applying || valid.length === 0}>
          {applying ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing…
            </>
          ) : (
            <>Import {valid.length} clients</>
          )}
        </Button>
      </div>
    </div>
  );
}

function ResultStep({
  result,
  onViewClients,
}: {
  result: ApplyImportResult;
  onViewClients: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-priority-done-bg)] text-[var(--color-priority-done)]">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">Import complete</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Everything below is now in your DueDateHQ organization. Deadlines
              were auto-generated for each entity.
            </p>

            <dl className="mt-5 grid gap-3 sm:grid-cols-4">
              <ResultStat label="Clients created" value={result.clientsCreated} />
              <ResultStat label="Entities created" value={result.entitiesCreated} />
              <ResultStat
                label="Deadlines generated"
                value={result.deadlinesGenerated}
              />
              <ResultStat
                label="Rows skipped"
                value={result.rowsSkipped}
                warn={result.rowsSkipped > 0}
              />
            </dl>

            {result.errors.length > 0 ? (
              <details className="mt-5">
                <summary className="cursor-pointer text-sm font-medium">
                  Errors ({result.errors.length})
                </summary>
                <ul className="mt-2 space-y-1 pl-4 text-xs text-muted-foreground">
                  {result.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>
                      Row {e.rowIndex + 1}: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            <div className="mt-6 flex gap-2">
              <Button onClick={onViewClients}>View all clients</Button>
              <Button variant="outline" asChild>
                <Link href="/dashboard">Go to dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: number;
  color: "done" | "medium" | "urgent";
  hint?: string;
}) {
  const colorMap = {
    done: "text-[var(--color-priority-done)]",
    medium: "text-[var(--color-priority-medium)]",
    urgent: "text-[var(--color-priority-urgent)]",
  };
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className={`mt-1 text-2xl font-semibold ${colorMap[color]}`}>
          {value}
        </p>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ResultStat({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-1 text-2xl font-semibold ${
          warn ? "text-[var(--color-priority-medium)]" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
