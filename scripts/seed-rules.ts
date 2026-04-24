/**
 * Seed script for the deadline_rules catalog.
 *
 * Run: `pnpm db:seed`
 *
 * Idempotent — uses natural key (jurisdiction + form + title) via onConflictDoNothing.
 * Sourcing: DueDateHQ 06-Seed Deadline 数据.md (all URLs verified against official sources).
 *
 * Rule shape:
 *   - `fixed_date`: { month, day, yearOffset?: 0|1|2 }
 *       yearOffset: how many years after taxYear. 0 = within tax year (rare),
 *       1 = filing year (default for most returns), 2 = Q4 estimate, Jan next-next year.
 *   - `election_window`: same shape as fixed_date + irrevocable flag on the row.
 *
 * Federal is represented once and applied to all clients regardless of state.
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { deadlineRules, ruleTypeEnum } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `vercel env pull .env.local` first.");
}

const neonClient = neon(process.env.DATABASE_URL);
const db = drizzle(neonClient);

type EntityType =
  | "individual"
  | "c_corp"
  | "s_corp"
  | "partnership"
  | "llc"
  | "trust"
  | "estate"
  | "nonprofit";

type RulePayload = { month: number; day: number; yearOffset?: number };

type SeedRule = {
  jurisdictionType: "federal" | "state" | "city";
  jurisdictionCode: string;
  formCode: string;
  title: string;
  description?: string;
  entityTypes: EntityType[];
  ruleType: (typeof ruleTypeEnum.enumValues)[number];
  rulePayload: RulePayload;
  extensionFormCode?: string;
  extensionPayload?: RulePayload;
  penaltySummary?: string;
  sourceUrl: string;
  irrevocable?: boolean;
};

// ---------------------------------------------------------------------------
// Federal
// ---------------------------------------------------------------------------

const FEDERAL: SeedRule[] = [
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "1040",
    title: "Form 1040 — Individual Income Tax Return",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionFormCode: "4868",
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    penaltySummary: "Failure-to-file 5%/mo (max 25%); failure-to-pay 0.5%/mo",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1040",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "1120",
    title: "Form 1120 — C-Corporation Tax Return",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionFormCode: "7004",
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1120",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "1120-S",
    title: "Form 1120-S — S-Corporation Tax Return",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionFormCode: "7004",
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    penaltySummary: "$245/shareholder/mo (max 12 mo)",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1120-s",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "1065",
    title: "Form 1065 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionFormCode: "7004",
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    penaltySummary: "$245/partner/mo (max 12 mo)",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1065",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "1041",
    title: "Form 1041 — Estates & Trusts",
    entityTypes: ["trust", "estate"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionFormCode: "7004",
    extensionPayload: { month: 9, day: 30, yearOffset: 1 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1041",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "990",
    title: "Form 990 — Tax-Exempt Organization Return",
    entityTypes: ["nonprofit"],
    ruleType: "fixed_date",
    rulePayload: { month: 5, day: 15, yearOffset: 1 },
    extensionFormCode: "8868",
    extensionPayload: { month: 11, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-990",
  },
  // Quarterly individual estimated tax
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "1040-ES-Q1",
    title: "Form 1040-ES Q1 — Individual Estimated Tax",
    entityTypes: ["individual", "s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    penaltySummary: "Form 2210 underpayment penalty (interest-based)",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1040-es",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "1040-ES-Q2",
    title: "Form 1040-ES Q2 — Individual Estimated Tax",
    entityTypes: ["individual", "s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 6, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1040-es",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "1040-ES-Q3",
    title: "Form 1040-ES Q3 — Individual Estimated Tax",
    entityTypes: ["individual", "s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1040-es",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "1040-ES-Q4",
    title: "Form 1040-ES Q4 — Individual Estimated Tax",
    entityTypes: ["individual", "s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 1, day: 15, yearOffset: 2 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1040-es",
  },
  // Quarterly payroll tax (for entities with employees)
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "941-Q1",
    title: "Form 941 Q1 — Quarterly Employer Payroll Tax",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc", "nonprofit"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 30, yearOffset: 1 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-941",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "941-Q2",
    title: "Form 941 Q2 — Quarterly Employer Payroll Tax",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc", "nonprofit"],
    ruleType: "fixed_date",
    rulePayload: { month: 7, day: 31, yearOffset: 1 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-941",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "941-Q3",
    title: "Form 941 Q3 — Quarterly Employer Payroll Tax",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc", "nonprofit"],
    ruleType: "fixed_date",
    rulePayload: { month: 10, day: 31, yearOffset: 1 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-941",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "941-Q4",
    title: "Form 941 Q4 — Quarterly Employer Payroll Tax",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc", "nonprofit"],
    ruleType: "fixed_date",
    rulePayload: { month: 1, day: 31, yearOffset: 2 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-941",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "940",
    title: "Form 940 — Annual FUTA Return",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc", "nonprofit"],
    ruleType: "fixed_date",
    rulePayload: { month: 1, day: 31, yearOffset: 1 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-940",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "W-2",
    title: "W-2 — Wage & Tax Statements",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc", "nonprofit"],
    ruleType: "fixed_date",
    rulePayload: { month: 1, day: 31, yearOffset: 1 },
    penaltySummary: "$60–$340/form tiered; $680/form for intentional disregard",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-w-2",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "1099-NEC",
    title: "Form 1099-NEC — Nonemployee Compensation",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc", "individual", "nonprofit"],
    ruleType: "fixed_date",
    rulePayload: { month: 1, day: 31, yearOffset: 1 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1099-nec",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "FinCEN-114",
    title: "FBAR — Foreign Bank Account Report",
    entityTypes: ["individual", "c_corp", "s_corp", "partnership", "llc", "trust"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.fincen.gov/report-foreign-bank-and-financial-accounts",
  },
];

// ---------------------------------------------------------------------------
// California
// ---------------------------------------------------------------------------

const CALIFORNIA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "CA",
    formCode: "CA-540",
    title: "CA Form 540 — Personal Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ftb.ca.gov/forms/2025/2025-540.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "CA",
    formCode: "CA-100",
    title: "CA Form 100 — C-Corporation Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ftb.ca.gov/forms/2025/2025-100.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "CA",
    formCode: "CA-100S",
    title: "CA Form 100S — S-Corporation Tax",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ftb.ca.gov/forms/2025/2025-100s.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "CA",
    formCode: "CA-568",
    title: "CA Form 568 — LLC Return",
    entityTypes: ["llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ftb.ca.gov/forms/2025/2025-568.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "CA",
    formCode: "CA-3522",
    title: "CA Form 3522 — LLC Annual Tax ($800 minimum)",
    description: "All CA LLCs owe $800 min annual tax regardless of income",
    entityTypes: ["llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ftb.ca.gov/forms/2025/2025-3522.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "CA",
    formCode: "CA-3893",
    title: "CA Form 3893 — PTE Elective Tax Prepayment",
    description: "50% of prior year PTE tax OR $1,000 — missing forfeits the election",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "election_window",
    rulePayload: { month: 6, day: 15, yearOffset: 0 },
    irrevocable: true,
    penaltySummary: "Election voided for the tax year — cannot cure",
    sourceUrl: "https://www.ftb.ca.gov/forms/2025/2025-3893.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "CA",
    formCode: "CA-540-ES-Q1",
    title: "CA Form 540-ES Q1 — 30% Estimated Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ftb.ca.gov/forms/2025/2025-540-es.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "CA",
    formCode: "CA-540-ES-Q2",
    title: "CA Form 540-ES Q2 — 40% Estimated Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 6, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ftb.ca.gov/forms/2025/2025-540-es.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "CA",
    formCode: "CA-540-ES-Q4",
    title: "CA Form 540-ES Q4 — 30% Estimated Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 1, day: 15, yearOffset: 2 },
    sourceUrl: "https://www.ftb.ca.gov/forms/2025/2025-540-es.html",
  },
];

// ---------------------------------------------------------------------------
// New York
// ---------------------------------------------------------------------------

const NEW_YORK: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "NY",
    formCode: "NY-IT-201",
    title: "NY Form IT-201 — Resident Personal Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionFormCode: "IT-370",
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.ny.gov/pit/file/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NY",
    formCode: "NY-CT-3",
    title: "NY Form CT-3 — General Business Corporation",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionFormCode: "CT-5",
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.ny.gov/bus/ct/article_9a.htm",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NY",
    formCode: "NY-CT-3-S",
    title: "NY Form CT-3-S — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionFormCode: "CT-5.4",
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.ny.gov/bus/ct/s_corp.htm",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NY",
    formCode: "NY-IT-204",
    title: "NY Form IT-204 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.ny.gov/bus/pit/pit_filing_partnership.htm",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NY",
    formCode: "NY-IT-204-LL",
    title: "NY Form IT-204-LL — LLC Annual Filing Fee",
    entityTypes: ["llc", "partnership"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.ny.gov/forms/current-forms/it/it204ll.htm",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NY",
    formCode: "NY-PTET",
    title: "⚠️ NY PTET Election — IRREVOCABLE by March 15",
    description:
      "Pass-Through Entity Tax election. IRREVOCABLE — miss this date and the entity CANNOT elect PTET for the tax year under any circumstance.",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "election_window",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    irrevocable: true,
    penaltySummary: "Election voided for the year — no extension, no cure",
    sourceUrl: "https://www.tax.ny.gov/bus/ptet/electing.htm",
  },
];

// ---------------------------------------------------------------------------
// Texas (no state income tax — franchise tax only)
// ---------------------------------------------------------------------------

const TEXAS: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "TX",
    formCode: "TX-Franchise",
    title: "TX Franchise Tax Report",
    description:
      "All TX entities must file even if No Tax Due. Failure forfeits TX charter / right to transact business.",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 5, day: 15, yearOffset: 1 },
    extensionFormCode: "05-164",
    extensionPayload: { month: 11, day: 15, yearOffset: 1 },
    penaltySummary: "$50 + 5-10% of tax (tiered by lateness)",
    sourceUrl: "https://comptroller.texas.gov/taxes/franchise/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "TX",
    formCode: "TX-PIR",
    title: "TX Public Information Report / Ownership Info Report",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 5, day: 15, yearOffset: 1 },
    sourceUrl: "https://comptroller.texas.gov/taxes/franchise/forms/",
  },
];

// ---------------------------------------------------------------------------
// Delaware
// ---------------------------------------------------------------------------

const DELAWARE: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "DE",
    formCode: "DE-PIT-RES",
    title: "DE Form 200-01 — Resident Personal Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 30, yearOffset: 1 },
    sourceUrl: "https://revenue.delaware.gov/individuals/personal-income-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "DE",
    formCode: "DE-1100",
    title: "DE Form 1100 — C-Corporation Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    sourceUrl: "https://revenue.delaware.gov/business-tax-forms/corporate-income-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "DE",
    formCode: "DE-1100-S",
    title: "DE Form 1100-S — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    sourceUrl: "https://revenue.delaware.gov/business-tax-forms/corporate-income-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "DE",
    formCode: "DE-300",
    title: "DE Form 300 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    sourceUrl: "https://revenue.delaware.gov/business-tax-forms/partnership-forms/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "DE",
    formCode: "DE-Franchise-Corp",
    title: "DE Annual Report + Franchise Tax (Corporations)",
    description:
      "ALL Delaware corporations must pay franchise tax — even if dormant or pre-revenue. Min $175 authorized-shares or $400 assumed-par, max $250k.",
    entityTypes: ["c_corp", "s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 1, yearOffset: 1 },
    penaltySummary: "$200 late fee + 1.5%/mo interest on unpaid",
    sourceUrl: "https://corp.delaware.gov/paytaxes/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "DE",
    formCode: "DE-LLC-300",
    title: "DE LLC/LP Annual Tax ($300 flat)",
    description: "All DE LLCs/LPs owe $300 flat annual tax regardless of activity.",
    entityTypes: ["llc", "partnership"],
    ruleType: "fixed_date",
    rulePayload: { month: 6, day: 1, yearOffset: 1 },
    penaltySummary: "$200 late fee + 1.5%/mo interest",
    sourceUrl: "https://corp.delaware.gov/paytaxes/",
  },
];

// ---------------------------------------------------------------------------
// New Jersey
// ---------------------------------------------------------------------------

const NEW_JERSEY: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "NJ",
    formCode: "NJ-1040",
    title: "NJ Form NJ-1040 — Gross Income Tax Return",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.state.nj.us/treasury/taxation/njit23.shtml",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NJ",
    formCode: "NJ-CBT-100",
    title: "NJ Form CBT-100 — Corporation Business Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.state.nj.us/treasury/taxation/cbt.shtml",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NJ",
    formCode: "NJ-CBT-100S",
    title: "NJ Form CBT-100S — S-Corporation Business Tax",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.state.nj.us/treasury/taxation/cbt.shtml",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NJ",
    formCode: "NJ-1065",
    title: "NJ Form NJ-1065 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.state.nj.us/treasury/taxation/partnership.shtml",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NJ",
    formCode: "NJ-PTE",
    title: "NJ BAIT — Pass-Through Entity Tax Election",
    description:
      "NJ BAIT election made with the return — less strict than NY PTET (no irrevocable March 15 cutoff).",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "election_window",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    irrevocable: false,
    sourceUrl: "https://www.state.nj.us/treasury/taxation/pteinformation.shtml",
  },
];

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

const ALL_RULES: SeedRule[] = [
  ...FEDERAL,
  ...CALIFORNIA,
  ...NEW_YORK,
  ...TEXAS,
  ...DELAWARE,
  ...NEW_JERSEY,
];

async function main() {
  console.log(`Seeding ${ALL_RULES.length} deadline rules…`);
  const EFFECTIVE_FROM = "2025-01-01";

  // Check which rules are already present (by jurisdiction + form_code + title + version)
  const existing = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*) as count FROM deadline_rules`,
  );
  console.log(`  Existing rules in DB: ${existing.rows[0]?.count ?? 0}`);

  let inserted = 0;
  for (const rule of ALL_RULES) {
    const result = await db
      .insert(deadlineRules)
      .values({
        jurisdictionType: rule.jurisdictionType,
        jurisdictionCode: rule.jurisdictionCode,
        formCode: rule.formCode,
        title: rule.title,
        description: rule.description,
        entityTypes: rule.entityTypes,
        ruleType: rule.ruleType,
        rulePayload: rule.rulePayload as Record<string, unknown>,
        extensionFormCode: rule.extensionFormCode,
        extensionPayload: rule.extensionPayload as Record<string, unknown> | undefined,
        penaltySummary: rule.penaltySummary,
        sourceUrl: rule.sourceUrl,
        version: 1,
        effectiveFrom: EFFECTIVE_FROM,
        irrevocable: rule.irrevocable ?? false,
      })
      .onConflictDoNothing()
      .returning({ id: deadlineRules.id });

    if (result.length > 0) inserted += 1;
  }

  console.log(`✅ Inserted ${inserted} new rules; ${ALL_RULES.length - inserted} already present.`);
  console.log(`   Total: ${ALL_RULES.length} rules across 6 jurisdictions.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
