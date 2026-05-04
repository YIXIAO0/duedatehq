import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ImportWizard } from "./import-wizard";

export default function ImportPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-3">
        <Link href="/clients">
          <ArrowLeft className="h-4 w-4" /> Back to clients
        </Link>
      </Button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Import clients
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring in your client list from a spreadsheet or File In Time export.
        </p>
      </div>

      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-muted/40" />}>
        <ImportWizard />
      </Suspense>
    </div>
  );
}
