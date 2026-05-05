# State expansion progress

Multi-phase workstream to lift DueDateHQ from "15 hand-picked states + IRS only"
to broad US coverage with state-level announcements and PTE election tracking.

## Goal & scope

Cover all 50 US states + DC for filing-deadline data, let CPAs mark
PTE elections per (entity, state), and surface state-DOR announcements
for a top-5 priority subset.

Out of scope (for now): US territories (PR/GU/VI), PTE tax calculation,
non-income state taxes (sales tax, gross receipts, franchise tax)
beyond what's already seeded.

## Phases

### Phase 0 — bedrock: canonical US_STATES constant — DONE 2026-05-03

Centralized the US-state list so 50-state expansion is data-driven.

- [x] Created `src/lib/constants/us-states.ts` exporting `US_STATES`
      (`{code, name}[]`), `US_STATE_CODES`, `US_STATE_NAME_TO_CODE`
      for the 50 states + DC
- [x] Replaced hardcoded 5-state arrays in 4 files:
      `clients/new/page.tsx`, `clients/[id]/add-entity-form.tsx`,
      `clients/[id]/entity-actions.tsx`, `clients/import/import-wizard.tsx`
- [x] Replaced 6-entry `STATE_OPTIONS` filter in
      `dashboard/dashboard-client.tsx` with `["federal", ...US_STATE_CODES]`
- [x] Rewrote `normalizeStateCode()` in `lib/import/mapping.ts` to use
      the canonical full-name → code map (was 10-state subset)
- [x] All dropdowns now show `"CODE — Full Name"` for parity across
      forms; `tsc --noEmit` passes clean

### Phase 1 — 50-state deadline rule seed — DONE 2026-05-03

Extended `scripts/seed-rules.ts` from 15 to 50 states + DC. Seed now
upserts **197 rules across 50 jurisdictions** (federal + 48 states with
filings; SD/WY are intentionally empty — no state-level filings exist
beyond federal for typical CPA clients).

- [x] Added 36 new state arrays (AL through WY) with filing + extension
      dates for individuals, C-corps, S-corps, and partnerships/LLCs
- [x] Verified the unusual ones via WebSearch + state DOR docs:
      - HI: all returns 4/20 (5 days after federal)
      - LA: all returns 5/15, ext 11/15
      - IA: individual + corp 4/30, ext 10/31
      - IN: individual extension 11/15 (7-month, not 6)
      - MT: C-corp CIT 5/15
      - CT: mandatory PTE Tax 3/15
      - NV: Commerce Tax annual 8/15, no extension
      - TN: F&E Tax 4/15, ext 11/15 (per Form FAE 173)
      - NH: BPT/BET 4/15
- [x] Standard federal-aligned states (AL/AR/CO/DC/ID/KS/KY/ME/MD/MN/
      MS/MO/NE/NM/ND/OK/OR/RI/SC/UT/VT/WV/WI): individual 4/15+10/15,
      C-corp 4/15+10/15, S-corp/partnership 3/15+9/15
- [x] Zero-state-tax states with business taxes: AK Form 6000, NH BPT/BET,
      TN F&E, NV Commerce Tax. SD/WY: empty (no state filings)
- [x] All entries cite official state DOR canonical pages in `sourceUrl`
- [x] Spot-checked the 8 unusual entries against DB rows after seed run

**Verify-later list** — entries I defaulted to federal calendar without
per-state instruction-doc verification. Worth a CPA pass before going
GA: estimated-payment schedules per state (most follow federal Apr/Jun/
Sep/Jan but some diverge); LLC-specific franchise taxes beyond what's
seeded; PTE election deadlines for the ~30 states with regimes.

### Phase 0.5 — long-dropdown UX fix — DONE 2026-05-03

After Phase 0 swapped 5-state arrays for 50+, every state Select grew
to ~52 items and overflowed the viewport. Fixed by capping
`<SelectContent>` to `max-h-[320px]` (subsequently superseded for the
4 home-state pickers — see Phase 0.6).

Also flipped the global `SelectContent` default from `position="item-aligned"`
to `position="popper"` in `components/ui/select.tsx` — `item-aligned`
mode lets content grow to natural height regardless of `max-h`.

### Phase 0.6 — searchable StateCombobox for the 4 home-state pickers — DONE 2026-05-04

Replaced the home-state Select with a search-filterable Combobox built
on top of cmdk + Popover. Type-ahead matches either code ("TX") or
name ("calif") — fastest path to picking a state out of 51.

- [x] New component `components/ui/state-combobox.tsx` — controlled,
      reusable, exposes `value` / `onChange` / `placeholder` / `id`
- [x] Replaced Select with StateCombobox in:
      - `clients/new/page.tsx` (controlled flow, direct swap)
      - `clients/[id]/add-entity-form.tsx` (form-action flow — added
        `useState` + hidden `<input name="homeState">` to keep the
        FormData shape unchanged for the server action)
      - `clients/[id]/entity-actions.tsx` (same hidden-input pattern)
      - `clients/import/import-wizard.tsx` EditRowDialog (controlled)
- [x] Dashboard jurisdiction filter intentionally LEFT as Select —
      mixes synthetic options ("All jurisdictions", "US Federal") with
      real codes; the 320px-capped Select is fine for that use case

### Phase 2 — PTE election marking + deadline surface — DONE 2026-05-04

Marking + opt-in deadline surfacing landed. Tax math out of scope per
user spec.

- [x] Schema: new `entity_elections` table (entity_id, org_id,
      jurisdiction_code, kind, elected_at) + new
      `deadline_rules.requires_election` column. Migration
      `0011_faithful_toxin.sql` generated; applied directly because
      migrations table was out of sync with the live schema (prior
      changes had been pushed via `db:push`)
- [x] Tagged 9 existing PTE election rules in seed with
      `requiresElection: "pte"` (CA-3893 / NY-PTET / NJ-PTE / OH IT
      4738 / GA-PTE-ELECT / MA-63D-ELT / VA-502PTET / AZ-PTE-ELECT /
      NC-PTE-ELECT). Re-seeded — DB now has 9 rules with the gate set
- [x] `selectApplicableRules()` in `deadline-engine.ts` gains an
      `electionFilter`: rules with `requires_election` set only emit
      deadline_instances when a matching `entity_elections` row exists
      for the same kind + jurisdiction. NULL `requires_election` →
      always surfaces (default behavior preserved)
- [x] Service layer in `lib/services/entity-elections.ts`:
      `electEntity` / `revokeElection` / `listElectionsForEntity` /
      `getPteJurisdictions` / `eligiblePteJurisdictionsForEntity`.
      Eligibility = pass-through entity type (s_corp / partnership /
      llc) ∩ entity footprint (home_state ∪ operating_states) ∩
      jurisdictions with seeded PTE rules
- [x] Server action `togglePteElectionAction` flips state, regenerates
      deadlines for current + prior tax year, revalidates client +
      dashboard paths
- [x] UI: `<PteElectionPills>` inline on each entity card. Optimistic
      toggle, disabled while pending, reverts on error. Only renders
      when entity has at least one eligible jurisdiction

**v1 caveats (worth flagging when scaling Phase 2 up):**

- Revoking an election does NOT delete already-materialized deadline
  instances. Engine just stops emitting new ones; CPA can archive
  manually. Acceptable for now — deletes risk losing notes/audit on
  instances they may have already started working
- 9 PTE-elected states currently (the ones with seeded rules). The
  other ~25 states with PTE regimes need rule data added before their
  pills appear in the UI — Phase 1 follow-up
- Hard-delete on revoke (no audit trail). `revoked_at` soft-delete
  pattern can be added later if "elected in 2025, revoked in 2027"
  history becomes load-bearing

### Phase 3 — state DOR announcement scrapers (top 5) — IN PROGRESS

User scope (confirmed 2026-05-03): **top 5 states first, not all 50**.

Architecture v1 + first state landed; the remaining 4 need per-state
HTML parser work that's best done with real-network HTML inspection.

- [x] Refactored `scrape-announcements.ts` from hardcoded IRS-only to
      source-pluggable. New module `lib/workflows/sources/`:
      - `types.ts` — `ParsedItem`, `SourceConfig`
      - `index.ts` — `SOURCES` registry, `getSource()`, `ALL_SOURCE_IDS`
      - `util.ts` — shared helpers (`stripHtml`, `decodeEntities`, …)
      - `irs-newsroom.ts` — extracted current IRS code, no behavior change
      - `tx-comptroller.ts` — TX Comptroller RSS 2.0 parser
- [x] Workflow signature changed to `scrapeAnnouncementsWorkflow(sourceId)`.
      AI classification prompt updated to be source-aware (state DORs
      default to their state code, not "federal").
- [x] Cron route fans out across all registered sources in parallel.
      `?source=<id>` flag for per-source debugging
- [ ] **CA FTB** — news at https://www.ftb.ca.gov/about-ftb/newsroom/news-releases/
      Blocks generic UAs; needs real-network HTML inspection to write
      a reliable parser. Single-page year listing.
- [ ] **NY DOR** — index at https://www.tax.ny.gov/press/rel/, year
      sub-pages like `/press/rel/2026/`. Two-step fetch (year index →
      individual release) or scrape the year page directly.
- [ ] **FL DOR** — single page at https://floridarevenue.com/Pages/media.aspx
      with releases inline (markdown-style `### date: title` blocks
      separated by `---`). Custom regex parser.
- [ ] **IL DOR** — current page at https://tax.illinois.gov/research/news.html
      is empty; archive at https://taxarchive.illinois.gov/research/news.html.
      May want to switch to https://www.illinois.gov/news/ filtered to
      IDOR-tagged items.

Source-id convention used: `irs_newsroom`, `tx_comptroller`,
`ca_ftb`, `ny_dor`, `fl_dor`, `il_dor`. Don't rename — the
`(source, external_id)` unique index keys against these strings.

## Decisions log

- **2026-05-03** — DC included in US_STATES; PR/territories excluded for v1
- **2026-05-03** — PTE = marking + deadline surface only, no tax math
- **2026-05-03** — State announcements: top 5 states first, not all 50
- **2026-05-03** — Phase order: 0 → 1 first, then 2/3 in either order

## Open questions

- For PTE marking: new `entity_elections` table, or `elections` jsonb
  column on `entities`? Pros/cons to walk through before implementing
- For Phase 1 estimated-payment dates: each state has slight variations
  (some Q4 in Jan of next year, some in Dec). Use state-specific dates
  or default to federal Q1-Q4 schedule? (Probably state-specific —
  that's the whole point.)
