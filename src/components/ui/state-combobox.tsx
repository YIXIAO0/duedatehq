"use client";

/**
 * Searchable state picker — drop-in replacement for the 50-entry
 * `<Select>` we used pre-Phase-0. Renders the canonical `US_STATES`
 * list with type-ahead match on either code (`"TX"`) or name
 * (`"calif"`). Returns the 2-letter code via `onChange`.
 *
 * Designed for data-entry surfaces (new client, edit entity, import
 * wizard). The dashboard's jurisdiction *filter* still uses Select
 * because that surface mixes synthetic values ("all", "federal")
 * with real state codes — Combobox is overkill for picking from
 * 5-10 frequent options.
 */

import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { US_STATES } from "@/lib/constants/us-states";

export function StateCombobox({
  value,
  onChange,
  placeholder = "Select state",
  id,
  disabled,
  className,
}: {
  /** Current 2-letter state code, or undefined for "no selection". */
  value: string | undefined;
  /** Fires with the new code, or undefined when the user clears the
   *  selection by re-selecting the current value. */
  onChange: (code: string | undefined) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = US_STATES.find((s) => s.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {selected ? `${selected.code} — ${selected.name}` : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-0"
      >
        <Command>
          <CommandInput placeholder="Search by code or name…" />
          <CommandList className="max-h-[280px]">
            <CommandEmpty>No state matches.</CommandEmpty>
            {value ? (
              <CommandGroup>
                <CommandItem
                  // Reset row — only rendered when a state IS selected.
                  // Keyword "clear" lets cmdk's filter still find it
                  // when the user has typed a search query.
                  value="__clear clear reset none"
                  onSelect={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                  <span>Clear</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup>
              {US_STATES.map((s) => (
                <CommandItem
                  key={s.code}
                  // Concatenate code + name so cmdk's fuzzy filter
                  // picks up either query shape.
                  value={`${s.code} ${s.name}`}
                  onSelect={() => {
                    onChange(s.code === value ? undefined : s.code);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "h-4 w-4",
                      value === s.code ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="w-7 font-mono text-xs">{s.code}</span>
                  <span>{s.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
