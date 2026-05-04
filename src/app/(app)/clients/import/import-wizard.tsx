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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  FileSpreadsheet,
  Download,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Pencil,
} from "lucide-react";
import { parseFile, extractSampleForSuggestion } from "@/lib/import/parse";
import {
  buildRowPreviews,
  suggestMappingHeuristic,
  validateMappedRow,
} from "@/lib/import/mapping";
import { FILE_IN_TIME_MAPPING } from "@/lib/import/file-in-time";
import {
  DUEDATE_FIELDS,
  type ApplyImportInput,
  type ApplyImportResult,
  type ColumnMapping,
  type DueDateField,
  type EntityType,
  type MappedRow,
  type ParsedSheet,
  type RowPreview,
} from "@/lib/import/types";
import { applyImportAction } from "./actions";
import {
  paletteForClient,
  clientInitials,
} from "@/lib/utils/client-palette";
import { cn } from "@/lib/utils";
import { StateCombobox } from "@/components/ui/state-combobox";

type Step = "upload" | "mapping" | "preview" | "result";

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

    const payload: ApplyImportInput = {
      rows: validRows,
      includeHistoricalAsCompleted: false,
    };

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

  // ---- step: preview row edits ------------------------------------------

  function updateRow(index: number, next: MappedRow) {
    const validated = validateMappedRow(next);
    setPreviews((prev) =>
      prev.map((p) =>
        p.index === index
          ? {
              ...p,
              mapped: validated.mapped,
              warnings: validated.warnings,
              errors: validated.errors,
            }
          : p,
      ),
    );
  }

  // =======================================================================
  // Render
  // =======================================================================

  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-6">
      <StepIndicator current={step} />

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {step === "upload" ? (
        <UploadStep onFile={handleFile} />
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
          onUpdateRow={updateRow}
        />
      ) : null}

      {step === "result" && result ? (
        <ResultStep
          result={result}
          onViewClients={() => router.push("/clients")}
        />
      ) : null}
    </div>
    </TooltipProvider>
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

function UploadStep({ onFile }: { onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);

  return (
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
          <p className="font-medium">Drop your XLSX or CSV here</p>
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
            onClick={() => document.getElementById("file-upload")?.click()}
          >
            Choose file
          </Button>
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
  const previewRows = previews.slice(0, 5);

  return (
    <div className="space-y-5">
      <MappingSourceBadge source={aiSource} pending={aiPending} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Map columns to DueDateHQ fields
          </CardTitle>
          <CardDescription>
            {sheet.totalRows} rows · {sheet.headers.length} columns detected
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
            {sheet.headers.map((header) => {
              const value = mapping[header] ?? "ignore";
              const isSkipped = value === "ignore";
              return (
                <div
                  key={header}
                  className={`group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/40 ${
                    isSkipped ? "opacity-70" : ""
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      className="inline-flex max-w-[140px] shrink-0 items-center truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-foreground/80"
                      title={header}
                    >
                      {header}
                    </span>
                    <span
                      aria-hidden
                      className="h-px flex-1 border-t border-dashed border-border"
                    />
                  </div>
                  <Select
                    value={value}
                    onValueChange={(v) =>
                      onMappingChange(header, v as DueDateField)
                    }
                  >
                    <SelectTrigger
                      className={`w-[170px] ${
                        isSkipped ? "text-muted-foreground" : ""
                      }`}
                    >
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
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview — first 5 rows</CardTitle>
          <CardDescription>
            What those rows look like after mapping. Fix the mapping above if
            something looks off.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {previewRows.map((p) => (
              <MappingPreviewRow key={p.index} preview={p} />
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Continue to preview</Button>
      </div>
    </div>
  );
}

function MappingSourceBadge({
  source,
  pending,
}: {
  source: "ai" | "heuristic" | "preset" | null;
  pending: boolean;
}) {
  if (pending) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Asking AI to suggest mappings…
      </div>
    );
  }
  if (source === "preset") {
    return (
      <div className="inline-flex items-center gap-2 rounded-full bg-[var(--color-priority-done-bg)] px-3 py-1.5 text-xs font-medium text-[var(--color-priority-done)]">
        <Sparkles className="h-3.5 w-3.5" />
        File In Time export detected — mapping applied automatically
      </div>
    );
  }
  if (source === "ai") {
    return (
      <div className="inline-flex items-center gap-2 rounded-full bg-[#FBF3DE] px-3 py-1.5 text-xs font-medium text-[#B68C2D]">
        <Sparkles className="h-3.5 w-3.5" />
        AI-suggested mapping — review below
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
      Heuristic mapping — review below
    </div>
  );
}

function MappingPreviewRow({ preview }: { preview: RowPreview }) {
  const name = preview.mapped.clientName?.trim();
  const palette = paletteForClient(name || `row-${preview.index}`);
  const initials = name ? clientInitials(name) : "?";

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
        style={{ background: palette.bg, color: palette.text }}
        aria-hidden
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {name ?? (
            <span className="italic text-muted-foreground">missing name</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {preview.mapped.entityType ? (
            <Badge variant="secondary" className="font-mono text-[10px]">
              {preview.mapped.entityType}
            </Badge>
          ) : null}
          {preview.mapped.homeState ? (
            <Badge variant="outline" className="text-[10px]">
              {preview.mapped.homeState}
            </Badge>
          ) : null}
          {preview.mapped.operatingStates?.length ? (
            <Badge variant="outline" className="text-[10px]">
              +{preview.mapped.operatingStates.length} states
            </Badge>
          ) : null}
          {preview.mapped.contactEmail ? (
            <span className="truncate text-xs text-muted-foreground">
              {preview.mapped.contactEmail}
            </span>
          ) : null}
        </div>
        {preview.warnings.map((w, i) => (
          <div
            key={i}
            className="mt-1 text-xs text-[var(--color-priority-medium)]"
          >
            ⚠ {w}
          </div>
        ))}
        {preview.errors.map((e, i) => (
          <div key={i} className="mt-1 text-xs text-destructive">
            ✕ {e}
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewStep({
  previews,
  onBack,
  onConfirm,
  applying,
  onUpdateRow,
}: {
  previews: RowPreview[];
  onBack: () => void;
  onConfirm: () => void;
  applying: boolean;
  onUpdateRow: (index: number, mapped: MappedRow) => void;
}) {
  const valid = previews.filter((p) => p.errors.length === 0);
  const errored = previews.filter((p) => p.errors.length > 0);
  const warned = previews.filter(
    (p) => p.warnings.length > 0 && p.errors.length === 0,
  );
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Show problem rows (errors first, then warnings) at the top of the list,
  // followed by the clean ones, so the user lands on what needs attention.
  const ordered = [
    ...errored,
    ...warned,
    ...previews.filter(
      (p) => p.errors.length === 0 && p.warnings.length === 0,
    ),
  ];

  const editingRow =
    editingIndex !== null
      ? previews.find((p) => p.index === editingIndex) ?? null
      : null;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard label="Ready to import" value={valid.length} color="done" />
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
          hint="Click row to fix"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Review {previews.length} rows
          </CardTitle>
          <CardDescription>
            This will create <strong>{valid.length} clients</strong> +{" "}
            <strong>{valid.length} tax entities</strong>.
            {errored.length > 0 ? (
              <>
                {" "}
                Click any <strong>skipped</strong> row to fix it and move it
                into the import.
              </>
            ) : null}
            {warned.length > 0 ? (
              <>
                {" "}
                Click any <strong>flagged</strong> row to refine it before
                importing.
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[420px] overflow-auto divide-y divide-border">
            {ordered.slice(0, 200).map((p) => {
              const editable =
                p.errors.length > 0 || p.warnings.length > 0;
              return (
                <PreviewRow
                  key={p.index}
                  preview={p}
                  editable={editable}
                  onClick={
                    editable ? () => setEditingIndex(p.index) : undefined
                  }
                />
              );
            })}
            {ordered.length > 200 ? (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                … and {ordered.length - 200} more (will still be imported, just
                not listed here for performance).
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={onBack} disabled={applying}>
          Back
        </Button>
        <Button onClick={onConfirm} disabled={applying || valid.length === 0}>
          {applying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Importing…
            </>
          ) : (
            <>Import {valid.length} clients</>
          )}
        </Button>
      </div>

      {editingRow ? (
        <EditRowDialog
          row={editingRow}
          onCancel={() => setEditingIndex(null)}
          onSave={(next) => {
            onUpdateRow(editingRow.index, next);
            setEditingIndex(null);
          }}
        />
      ) : null}
    </div>
  );
}

function PreviewRow({
  preview,
  editable,
  onClick,
}: {
  preview: RowPreview;
  editable: boolean;
  onClick?: () => void;
}) {
  const hasError = preview.errors.length > 0;
  const hasWarning = !hasError && preview.warnings.length > 0;
  const display = preview.mapped.clientName?.trim() || (
    <span className="text-muted-foreground italic">(no name)</span>
  );

  const content = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="shrink-0">
          {hasError ? (
            <XCircle className="h-3.5 w-3.5 text-[var(--color-priority-urgent)]" />
          ) : hasWarning ? (
            <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-priority-medium)]" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-priority-done)]" />
          )}
        </span>
        <span className="truncate font-medium">
          Row {preview.index + 1} · {display}
        </span>
        {preview.mapped.entityType ? (
          <Badge variant="secondary" className="font-mono text-xs">
            {preview.mapped.entityType}
          </Badge>
        ) : null}
        {preview.mapped.homeState ? (
          <Badge variant="outline" className="text-xs">
            {preview.mapped.homeState}
          </Badge>
        ) : null}
        {hasError ? (
          <span className="truncate text-xs text-[var(--color-priority-urgent)]">
            {preview.errors.join("; ")}
          </span>
        ) : hasWarning ? (
          <span className="truncate text-xs text-[var(--color-priority-medium)]">
            {preview.warnings.join("; ")}
          </span>
        ) : null}
      </div>
      {editable ? (
        <Pencil
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground",
            hasWarning && "opacity-50",
          )}
        />
      ) : null}
    </>
  );

  if (editable) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/40"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-sm">
      {content}
    </div>
  );
}

const ENTITY_TYPE_OPTIONS: Array<{ value: EntityType; label: string }> = [
  { value: "individual", label: "Individual (1040)" },
  { value: "s_corp", label: "S-Corporation (1120-S)" },
  { value: "c_corp", label: "C-Corporation (1120)" },
  { value: "partnership", label: "Partnership (1065)" },
  { value: "llc", label: "LLC" },
  { value: "trust", label: "Trust (1041)" },
  { value: "estate", label: "Estate (1041)" },
  { value: "nonprofit", label: "Nonprofit (990)" },
];

function EditRowDialog({
  row,
  onCancel,
  onSave,
}: {
  row: RowPreview;
  onCancel: () => void;
  onSave: (next: MappedRow) => void;
}) {
  const [clientName, setClientName] = useState(row.mapped.clientName ?? "");
  const [entityName, setEntityName] = useState(row.mapped.entityName ?? "");
  const [entityType, setEntityType] = useState<EntityType>(
    row.mapped.entityType ?? "individual",
  );
  const [homeState, setHomeState] = useState(row.mapped.homeState ?? "");
  const [operatingStates, setOperatingStates] = useState(
    (row.mapped.operatingStates ?? []).join(", "),
  );
  const [ein, setEin] = useState(row.mapped.ein ?? "");
  const [contactEmail, setContactEmail] = useState(
    row.mapped.contactEmail ?? "",
  );
  const [contactPhone, setContactPhone] = useState(
    row.mapped.contactPhone ?? "",
  );
  const [notes, setNotes] = useState(row.mapped.notes ?? "");

  function save() {
    const opStates = operatingStates
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]{2}$/.test(s));
    onSave({
      clientName: clientName.trim() || undefined,
      entityName: entityName.trim() || undefined,
      entityType,
      homeState: homeState || undefined,
      operatingStates: opStates.length > 0 ? opStates : undefined,
      ein: ein.trim() || undefined,
      contactEmail: contactEmail.trim() || undefined,
      contactPhone: contactPhone.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit row {row.index + 1}</DialogTitle>
          <DialogDescription>
            Fix any missing or wrong fields. Saving re-checks this row against
            the import rules.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="er-clientName">Client name *</Label>
            <Input
              id="er-clientName"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              maxLength={200}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="er-entityName">Entity name</Label>
            <Input
              id="er-entityName"
              value={entityName}
              onChange={(e) => setEntityName(e.target.value)}
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              Defaults to client name if blank.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="er-entityType">Entity type</Label>
            <Select
              value={entityType}
              onValueChange={(v) => setEntityType(v as EntityType)}
            >
              <SelectTrigger id="er-entityType" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="er-homeState">Home state</Label>
            <StateCombobox
              id="er-homeState"
              value={homeState || undefined}
              onChange={(code) => setHomeState(code ?? "")}
              placeholder="None"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="er-operatingStates">Operating states</Label>
            <Input
              id="er-operatingStates"
              value={operatingStates}
              onChange={(e) => setOperatingStates(e.target.value)}
              placeholder="CA, NY, TX"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="er-ein">EIN / SSN</Label>
            <Input
              id="er-ein"
              value={ein}
              onChange={(e) => setEin(e.target.value)}
              maxLength={20}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="er-contactEmail">Contact email</Label>
            <Input
              id="er-contactEmail"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="er-contactPhone">Contact phone</Label>
            <Input
              id="er-contactPhone"
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              maxLength={50}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="er-notes">Notes</Label>
            <Textarea
              id="er-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={save}>Save row</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
              <div className="mt-6 rounded-md border border-[var(--color-priority-medium)]/30 bg-[var(--color-priority-medium-bg)] p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-priority-medium)]" />
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-[var(--color-priority-medium)]">
                      {result.errors.length}{" "}
                      {result.errors.length === 1 ? "row" : "rows"} need your
                      attention
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      These rows had issues during import. Review below and fix
                      from the clients page.
                    </p>
                    <ul className="mt-3 space-y-3">
                      {result.errors.slice(0, 20).map((e, i) => (
                        <li
                          key={i}
                          className="border-l-2 border-[var(--color-priority-medium)]/40 pl-3 text-xs"
                        >
                          <div className="font-medium text-foreground">
                            Row {e.rowIndex + 1}
                            {e.clientName ? (
                              <span className="text-muted-foreground">
                                {" · "}
                                {e.clientName}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-muted-foreground">
                            {e.message}
                          </div>
                          {e.suggestion ? (
                            <div className="mt-1 text-foreground/80">
                              <span className="font-medium">Next step:</span>{" "}
                              {e.suggestion}
                            </div>
                          ) : null}
                        </li>
                      ))}
                      {result.errors.length > 20 ? (
                        <li className="pl-3 text-xs text-muted-foreground">
                          … and {result.errors.length - 20} more
                        </li>
                      ) : null}
                    </ul>
                  </div>
                </div>
              </div>
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
