"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Users,
  Building2,
  Calendar,
  Search as SearchIcon,
  Loader2,
} from "lucide-react";
import type { SearchHit } from "@/lib/services/search";

/**
 * Command palette triggered by Cmd+K / Ctrl+K.
 *
 * Header exposes a compact "Search" button that also opens it (so mouse
 * users don't have to know the shortcut).
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyboard: Cmd+K / Ctrl+K toggles the palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced fetch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setHits([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
        );
        if (!res.ok) throw new Error(`Search ${res.status}`);
        const data = (await res.json()) as { results: SearchHit[] };
        setHits(data.results ?? []);
      } catch (err) {
        console.error(err);
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      router.push(href);
    },
    [router],
  );

  const clients = hits.filter((h) => h.type === "client");
  const entities = hits.filter((h) => h.type === "entity");
  const deadlines = hits.filter((h) => h.type === "deadline");

  return (
    <>
      {/* Trigger — visible in header */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Search"
      >
        <SearchIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="ml-2 hidden rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
          ⌘K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Find clients, entities, and deadlines"
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search clients, entities, deadlines..."
        />
        <CommandList>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Searching…
            </div>
          ) : null}

          {!loading && query && hits.length === 0 ? (
            <CommandEmpty>
              No results for &ldquo;{query}&rdquo;.
            </CommandEmpty>
          ) : null}

          {!loading && !query ? (
            // Compact empty state — the big title/subtitle was making the
            // dialog look half-empty. Now a single hint line that fits
            // the new 44px-input + 560px-wide palette proportions.
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              <SearchIcon className="h-3 w-3" />
              Start typing — searches clients, entities, and deadlines.
            </div>
          ) : null}

          {clients.length > 0 ? (
            <CommandGroup heading="Clients">
              {clients.map((hit) => (
                <CommandItem
                  key={`client-${hit.id}`}
                  value={`client-${hit.id}-${hit.title}`}
                  onSelect={() => go(hit.href)}
                  className="cursor-pointer"
                >
                  <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{hit.title}</div>
                    {hit.subtitle ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {hit.subtitle}
                      </div>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {entities.length > 0 ? (
            <>
              {clients.length > 0 ? <CommandSeparator /> : null}
              <CommandGroup heading="Entities">
                {entities.map((hit) => (
                  <CommandItem
                    key={`entity-${hit.id}`}
                    value={`entity-${hit.id}-${hit.title}`}
                    onSelect={() => go(hit.href)}
                    className="cursor-pointer"
                  >
                    <Building2 className="mr-2 h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{hit.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {hit.subtitle}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}

          {deadlines.length > 0 ? (
            <>
              {clients.length + entities.length > 0 ? (
                <CommandSeparator />
              ) : null}
              <CommandGroup heading="Upcoming deadlines">
                {deadlines.map((hit) => {
                  const isDeadline = hit.type === "deadline";
                  return (
                    <CommandItem
                      key={`deadline-${hit.id}`}
                      value={`deadline-${hit.id}-${hit.title}`}
                      onSelect={() => go(hit.href)}
                      className="cursor-pointer"
                    >
                      <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{hit.title}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {hit.subtitle}
                        </div>
                      </div>
                      {isDeadline ? (
                        <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                          {new Date(
                            hit.dueDate + "T00:00:00",
                          ).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
