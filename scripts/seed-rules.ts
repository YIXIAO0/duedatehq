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
import {
  deadlineRules,
  ruleTypeEnum,
  serviceGroups,
  serviceGroupRules,
} from "../src/lib/db/schema";
import { sql, eq, and, isNull, inArray } from "drizzle-orm";

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

type RulePayload = {
  // Absolute mode (calendar dates):
  month?: number;
  day?: number;
  yearOffset?: number;
  // FYE-relative mode (Nth month after fiscal year end):
  fyeMonthOffset?: number;
  fyeDayOfMonth?: number;
};

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
  /**
   * When set (e.g. "pte"), this rule only surfaces for entities that
   * have a matching `entity_elections` row. Used for opt-in deadlines
   * like state PTE elections that shouldn't clutter the deadline list
   * for entities that haven't opted in.
   */
  requiresElection?: string;
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
  // FYE-relative rules below. IRC § 6072(a)/(b): the 15th day of the
  // Nth month after the close of the entity's fiscal year. For
  // calendar-year entities (Dec 31 FYE — the default) these reduce to
  // the familiar Apr 15 / Mar 15 / May 15 dates. For Jun 30 FYE
  // C-corps the engine correctly computes Oct 15.
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "1120",
    title: "Form 1120 — C-Corporation Tax Return",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { fyeMonthOffset: 4, fyeDayOfMonth: 15 },
    extensionFormCode: "7004",
    extensionPayload: { fyeMonthOffset: 10, fyeDayOfMonth: 15 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1120",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "1120-S",
    title: "Form 1120-S — S-Corporation Tax Return",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { fyeMonthOffset: 3, fyeDayOfMonth: 15 },
    extensionFormCode: "7004",
    extensionPayload: { fyeMonthOffset: 9, fyeDayOfMonth: 15 },
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
    rulePayload: { fyeMonthOffset: 3, fyeDayOfMonth: 15 },
    extensionFormCode: "7004",
    extensionPayload: { fyeMonthOffset: 9, fyeDayOfMonth: 15 },
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
    rulePayload: { fyeMonthOffset: 4, fyeDayOfMonth: 15 },
    extensionFormCode: "7004",
    extensionPayload: { fyeMonthOffset: 9, fyeDayOfMonth: 30 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1041",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "990",
    title: "Form 990 — Tax-Exempt Organization Return",
    entityTypes: ["nonprofit"],
    ruleType: "fixed_date",
    rulePayload: { fyeMonthOffset: 5, fyeDayOfMonth: 15 },
    extensionFormCode: "8868",
    extensionPayload: { fyeMonthOffset: 11, fyeDayOfMonth: 15 },
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
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "1099-MISC",
    title: "Form 1099-MISC — Miscellaneous Information",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc", "individual", "nonprofit"],
    ruleType: "fixed_date",
    // Paper file: Feb 28; e-file: Mar 31. Most CPAs e-file these days,
    // but the most defensible "always-safe" date is Feb 28. We use that
    // and let CPAs file later when they e-file via their software.
    rulePayload: { month: 2, day: 28, yearOffset: 1 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1099-misc",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "W-3",
    title: "Form W-3 — Transmittal of Wage Statements (Paper)",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc", "nonprofit"],
    ruleType: "fixed_date",
    // W-3 is the paper transmittal that accompanies paper W-2s to the
    // SSA. Same Jan 31 deadline. E-filing W-2s makes W-3 unnecessary.
    rulePayload: { month: 1, day: 31, yearOffset: 1 },
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-w-3",
  },
  {
    jurisdictionType: "federal",
    jurisdictionCode: "federal",
    formCode: "5500",
    title: "Form 5500 — Retirement Plan Annual Return",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc", "nonprofit"],
    ruleType: "fixed_date",
    // 5500 is due the last day of the 7th month after the plan year
    // end. For calendar-year plans (most common): July 31 of the
    // following year. fyeDayOfMonth=-1 means "last day of month",
    // handled by the engine.
    rulePayload: { fyeMonthOffset: 7, fyeDayOfMonth: -1 },
    extensionFormCode: "5558",
    extensionPayload: { fyeMonthOffset: 10, fyeDayOfMonth: 15 },
    penaltySummary: "$250/day to $150,000 max for late filing",
    sourceUrl: "https://www.dol.gov/agencies/ebsa/employers-and-advisers/plan-administration-and-compliance/reporting-and-filing/form-5500",
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
    requiresElection: "pte",
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
    requiresElection: "pte",
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
    requiresElection: "pte",
  },
];

// ---------------------------------------------------------------------------
// Pennsylvania (PA) — flat 3.07% personal, 7.99% corporate (phasing down).
// CNIT conforms to federal + 30 days, so C-corp returns land ~May 15. PTET
// via Act 53 of 2022 — elected annually on the return, no separate form.
// ---------------------------------------------------------------------------

const PENNSYLVANIA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "PA",
    formCode: "PA-40",
    title: "PA-40 — Personal Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionFormCode: "REV-276",
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.pa.gov/FormsandPublications/FormsforIndividuals/PIT/Pages/default.aspx",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "PA",
    formCode: "PA-20S/PA-65",
    title: "PA-20S/PA-65 — S-Corp / Partnership Return",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.pa.gov/FormsandPublications/FormsforBusinesses/PartnershipPA-SCorp/Pages/default.aspx",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "PA",
    formCode: "RCT-101",
    title: "RCT-101 — Corporate Net Income Tax",
    description: "Due 30 days after federal — ~May 15 for calendar-year corps",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 5, day: 15, yearOffset: 1 },
    extensionPayload: { month: 11, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.pa.gov/FormsandPublications/FormsforBusinesses/CT/Pages/default.aspx",
  },
];

// ---------------------------------------------------------------------------
// Illinois (IL) — flat 4.95% personal, 9.5% combined corporate (CIT + replacement).
// PTE tax is elected on the annual return; no separate form. Extensions are
// automatic for individuals if you're paid up.
// ---------------------------------------------------------------------------

const ILLINOIS: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "IL",
    formCode: "IL-1040",
    title: "IL-1040 — Personal Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.illinois.gov/forms/incometax/individual.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "IL",
    formCode: "IL-1120",
    title: "IL-1120 — Corporate Income & Replacement Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.illinois.gov/forms/incometax/business.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "IL",
    formCode: "IL-1120-ST",
    title: "IL-1120-ST — S-Corporation Return",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.illinois.gov/forms/incometax/business.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "IL",
    formCode: "IL-1065",
    title: "IL-1065 — Partnership Replacement Tax Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.illinois.gov/forms/incometax/business.html",
  },
];

// ---------------------------------------------------------------------------
// Ohio (OH) — state income tax conforms to federal 4/15. CAT (gross receipts)
// raised its minimum to $3M in 2024 so most small businesses are exempt; we
// skip the quarterly CAT here. Municipal income tax (RITA/CCA) is its own
// universe of ~700 cities — V2. PTET is the newer IT 4738.
// ---------------------------------------------------------------------------

const OHIO: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "OH",
    formCode: "IT 1040",
    title: "IT 1040 — Ohio Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.ohio.gov/individual/forms",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "OH",
    formCode: "IT 4708",
    title: "IT 4708 — Pass-Through Entity Composite Return",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.ohio.gov/business/ohio-business-taxes/pass-through-entity",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "OH",
    formCode: "IT 4738",
    title: "IT 4738 — Electing Pass-Through Entity Tax",
    description: "PTET election — irrevocable once filed; use if PTE income is high enough to beat the $10K SALT cap",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "election_window",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    irrevocable: true,
    penaltySummary: "Election is irrevocable for the tax year",
    sourceUrl: "https://tax.ohio.gov/business/ohio-business-taxes/pass-through-entity",
    requiresElection: "pte",
  },
];

// ---------------------------------------------------------------------------
// Georgia (GA) — flat 5.39% personal (2024), C-corp 5.75%. PTET (HB 149 /
// 2022) is elected annually on the entity return and is irrevocable for
// that year. GA also imposes a Net Worth Tax on C-corps alongside income.
// ---------------------------------------------------------------------------

const GEORGIA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "GA",
    formCode: "GA-500",
    title: "GA-500 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionFormCode: "IT-303",
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.georgia.gov/taxes/individual-income-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "GA",
    formCode: "GA-600",
    title: "GA-600 — Corporate Income & Net Worth Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.georgia.gov/taxes/corporate-income-and-net-worth-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "GA",
    formCode: "GA-600S",
    title: "GA-600S — S-Corporation Tax Return",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.georgia.gov/taxes/s-corporations",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "GA",
    formCode: "GA-700",
    title: "GA-700 — Partnership Tax Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.georgia.gov/taxes/partnerships",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "GA",
    formCode: "GA-PTE-ELECT",
    title: "GA PTE Tax Election (on GA-600S / GA-700)",
    description: "PTET election made on the entity return — irrevocable once filed",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "election_window",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    irrevocable: true,
    penaltySummary: "Election is irrevocable for the tax year once return filed",
    sourceUrl: "https://dor.georgia.gov/taxes/pass-through-entity-tax",
    requiresElection: "pte",
  },
];

// ---------------------------------------------------------------------------
// Massachusetts (MA) — 5% personal (most types), 9% LT cap gains surtax
// over $1M. Patriots' Day often bumps 4/15 to 4/17-18 but the nominal
// statutory date is still April 15; deadline engine can apply holiday
// shifts later. 63D-ELT is the PTET (enacted 2021).
// ---------------------------------------------------------------------------

const MASSACHUSETTS: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "MA",
    formCode: "MA-1",
    title: "Form 1 — Massachusetts Resident Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionFormCode: "M-4868",
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.mass.gov/forms/2024-form-1-massachusetts-resident-income-tax-return",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MA",
    formCode: "MA-355",
    title: "Form 355 — Corporate Excise Return",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.mass.gov/forms/2024-form-355-business-or-manufacturing-corporation-excise-return",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MA",
    formCode: "MA-355S",
    title: "Form 355S — S-Corporation Excise Return",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.mass.gov/forms/2024-form-355s-s-corporation-excise-return",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MA",
    formCode: "MA-3",
    title: "Form 3 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.mass.gov/forms/2024-form-3-partnership-return-of-income",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MA",
    formCode: "MA-63D-ELT",
    title: "Form 63D-ELT — Pass-Through Entity Tax Election",
    description: "MA PTET — elected annually with the entity return; payment via 63D-ELT-EST quarterlies",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "election_window",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    irrevocable: true,
    penaltySummary: "Election made on timely return — irrevocable for the year",
    sourceUrl: "https://www.mass.gov/info-details/pass-through-entity-excise",
    requiresElection: "pte",
  },
];

// ---------------------------------------------------------------------------
// Virginia (VA) — UNIQUE: personal income tax due MAY 1, not April 15.
// Extension to Nov 1 is automatic if paid (Form 760IP for the payment
// side). Corporate/PTE returns track federal dates. 502PTET is the PTET
// introduced 2022.
// ---------------------------------------------------------------------------

const VIRGINIA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "VA",
    formCode: "VA-760",
    title: "Form 760 — Virginia Resident Income Tax",
    description: "VA personal income tax is due May 1 (NOT April 15)",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 5, day: 1, yearOffset: 1 },
    extensionFormCode: "760IP",
    extensionPayload: { month: 11, day: 1, yearOffset: 1 },
    sourceUrl: "https://www.tax.virginia.gov/individual-income-tax-filing",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "VA",
    formCode: "VA-500",
    title: "Form 500 — Virginia Corporation Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.virginia.gov/corporation-income-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "VA",
    formCode: "VA-502",
    title: "Form 502 — Pass-Through Entity Return",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.virginia.gov/pass-through-entities",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "VA",
    formCode: "VA-502PTET",
    title: "Form 502PTET — Pass-Through Entity Tax Election",
    description: "VA PTET — elected annually; election is irrevocable for the tax year",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "election_window",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    irrevocable: true,
    penaltySummary: "Election irrevocable for the tax year once return filed",
    sourceUrl: "https://www.tax.virginia.gov/pass-through-entities",
    requiresElection: "pte",
  },
];

// ---------------------------------------------------------------------------
// Washington (WA) — NO state personal or corporate income tax. Two income-
// adjacent deadlines CPAs still track: the Capital Gains Excise Tax (7% on
// LT gains > $262K threshold, 2024) and B&O for businesses. B&O cadence
// varies (monthly/quarterly/annual by volume) so we only include the
// annual-filer form here — the engine can layer quarterly B&O in V2.
// ---------------------------------------------------------------------------

const WASHINGTON: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "WA",
    formCode: "WA-CAP-GAINS",
    title: "WA Capital Gains Excise Tax Return",
    description: "7% on LT cap gains > $262K threshold (2024); tied to federal return due date",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.wa.gov/taxes-rates/other-taxes/capital-gains-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "WA",
    formCode: "WA-BO-ANNUAL",
    title: "WA Business & Occupation Tax — Annual filers",
    description: "For businesses with gross income under WA's annual-filer threshold (~$100K)",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.wa.gov/taxes-rates/business-occupation-tax",
  },
];

// ---------------------------------------------------------------------------
// Arizona (AZ) — flat 2.5% personal (2023+), competitive corporate. PTET
// (Form 165PTE) introduced 2022, election annual + irrevocable.
// ---------------------------------------------------------------------------

const ARIZONA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "AZ",
    formCode: "AZ-140",
    title: "Form 140 — Arizona Resident Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionFormCode: "AZ-204",
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://azdor.gov/forms/individual",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "AZ",
    formCode: "AZ-120",
    title: "Form 120 — Arizona Corporate Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://azdor.gov/forms/corporate-tax-forms",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "AZ",
    formCode: "AZ-120S",
    title: "Form 120S — Arizona S-Corporation Income Tax",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://azdor.gov/forms/corporate-tax-forms",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "AZ",
    formCode: "AZ-165",
    title: "Form 165 — Arizona Partnership Income Tax",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://azdor.gov/forms/partnership-forms",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "AZ",
    formCode: "AZ-PTE-ELECT",
    title: "AZ Pass-Through Entity Tax Election",
    description: "Election made with the entity return (Form 120S / 165); irrevocable for year",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "election_window",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    irrevocable: true,
    penaltySummary: "Election is irrevocable for the tax year once return filed",
    sourceUrl: "https://azdor.gov/business/pass-through-entity-tax",
    requiresElection: "pte",
  },
];

// ---------------------------------------------------------------------------
// North Carolina (NC) — flat 4.5% personal (2024), dropping to 3.99% by 2026.
// Conforms to federal dates. PTET via D-403/CD-401S starts 2022.
// ---------------------------------------------------------------------------

const NORTH_CAROLINA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "NC",
    formCode: "NC-D-400",
    title: "D-400 — North Carolina Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionFormCode: "D-410",
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ncdor.gov/taxes-forms/individual-income-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NC",
    formCode: "NC-CD-405",
    title: "CD-405 — NC Corporate Income & Franchise Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionFormCode: "CD-419",
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ncdor.gov/taxes-forms/corporate-income-franchise-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NC",
    formCode: "NC-CD-401S",
    title: "CD-401S — NC S-Corporation Tax Return",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ncdor.gov/taxes-forms/corporate-income-franchise-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NC",
    formCode: "NC-D-403",
    title: "D-403 — NC Partnership Income Tax",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ncdor.gov/taxes-forms/partnership-income-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NC",
    formCode: "NC-PTE-ELECT",
    title: "NC Pass-Through Entity Tax Election",
    description: "Election made on CD-401S or D-403; irrevocable for the year",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "election_window",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    irrevocable: true,
    penaltySummary: "Election is irrevocable for the tax year once return filed",
    sourceUrl: "https://www.ncdor.gov/taxes-forms/taxed-pass-through-entity",
    requiresElection: "pte",
  },
];

// ---------------------------------------------------------------------------
// Florida (FL) — NO personal income tax. 5.5% corporate, due May 1 for
// calendar-year filers (1st day of 5th month after YE). S-corps are NOT
// taxed at entity level (passthrough only). Partnership return F-1065 is
// for informational purposes. FL Annual Report ($138.75) is administered
// by Division of Corporations, not DOR — skipping for V2 alongside other
// SoS filings.
// ---------------------------------------------------------------------------

const FLORIDA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "FL",
    formCode: "FL-F-1120",
    title: "Form F-1120 — FL Corporate Income Tax",
    description: "Due 1st day of 5th month after year end (~May 1 for calendar year)",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 5, day: 1, yearOffset: 1 },
    extensionPayload: { month: 11, day: 1, yearOffset: 1 },
    sourceUrl: "https://floridarevenue.com/taxes/taxesfees/Pages/corporate.aspx",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "FL",
    formCode: "FL-F-1065",
    title: "Form F-1065 — FL Partnership Information Return",
    description: "Informational — FL has no partnership-level income tax",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    sourceUrl: "https://floridarevenue.com/Forms_library/current/f1065.pdf",
  },
];

// ---------------------------------------------------------------------------
// Round 9 — remaining 36 jurisdictions to bring coverage to 50 + DC
//
// Most states piggyback on the federal calendar: individual returns due
// 4/15 with a 6-month extension to 10/15, partnership / S-corp returns
// 3/15 (15th of 3rd month) with extension to 9/15, C-corp returns 4/15
// with extension to 10/15. Where a state diverges (HI 4/20, LA 5/15,
// IA 4/30, IN 7-month extension, MT C-corp 5/15) the rule below has
// the verified date and points at the official instruction page.
//
// Pure no-income-tax states (AK / NV / NH / SD / TN / WY — TX/WA/FL
// already covered above) get whatever business-level tax actually
// matters to a CPA: AK corporate income tax (Form 6000), NV Commerce
// Tax, NH Business Profits Tax, TN Franchise & Excise Tax, etc.
// SD and WY have nothing meaningful at the state level beyond federal.
// ---------------------------------------------------------------------------

const ALABAMA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "AL",
    formCode: "AL-40",
    title: "AL Form 40 — Individual Income Tax Return",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.alabama.gov/individual-corporate/individual-income-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "AL",
    formCode: "AL-20C",
    title: "AL Form 20C — C-Corporation Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.alabama.gov/individual-corporate/corporate-income-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "AL",
    formCode: "AL-20S",
    title: "AL Form 20S — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.alabama.gov/individual-corporate/pass-thru-entities-subchapter-k-entities-partnerships-and-s-corporations/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "AL",
    formCode: "AL-65",
    title: "AL Form 65 — Partnership / LLC Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.alabama.gov/individual-corporate/pass-thru-entities-subchapter-k-entities-partnerships-and-s-corporations/",
  },
];

const ALASKA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "AK",
    formCode: "AK-6000",
    title: "AK Form 6000 — Corporation Net Income Tax",
    description: "AK has no individual income tax; this is the only meaningful state filing for businesses",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.alaska.gov/programs/programs/index.aspx?60010",
  },
];

const ARKANSAS: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "AR",
    formCode: "AR-1000F",
    title: "AR Form AR1000F — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.dfa.arkansas.gov/income-tax/individual-income-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "AR",
    formCode: "AR-1100CT",
    title: "AR Form AR1100CT — Corporation Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.dfa.arkansas.gov/income-tax/corporation-income-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "AR",
    formCode: "AR-1100S",
    title: "AR Form AR1100S — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.dfa.arkansas.gov/income-tax/corporation-income-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "AR",
    formCode: "AR-1050",
    title: "AR Form AR1050 — Partnership Income Tax",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.dfa.arkansas.gov/income-tax/partnership-income-tax/",
  },
];

const COLORADO: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "CO",
    formCode: "CO-DR-0104",
    title: "CO Form DR 0104 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.colorado.gov/individual-income-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "CO",
    formCode: "CO-DR-0112",
    title: "CO Form DR 0112 — C-Corporation Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.colorado.gov/corporate-income-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "CO",
    formCode: "CO-DR-0106",
    title: "CO Form DR 0106 — Partnership / S-Corporation",
    description: "CO files partnerships and S-corps on the same form, due 4th-month-15th (4/15 calendar)",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.colorado.gov/partnerships-S-corporations",
  },
];

const CONNECTICUT: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "CT",
    formCode: "CT-1040",
    title: "CT Form CT-1040 — Resident Income Tax Return",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionFormCode: "CT-1040-EXT",
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://portal.ct.gov/DRS/Individuals/Individual-Income-Tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "CT",
    formCode: "CT-1120",
    title: "CT Form CT-1120 — Corporation Business Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 5, day: 15, yearOffset: 1 },
    extensionPayload: { month: 11, day: 15, yearOffset: 1 },
    sourceUrl: "https://portal.ct.gov/DRS/Corporation-Tax/Corporation-Business-Tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "CT",
    formCode: "CT-1065-1120SI",
    title: "CT Form CT-1065/CT-1120SI — Pass-Through Entity Tax",
    description: "CT is the only state with a MANDATORY PTE tax — every PE must file regardless of election",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://portal.ct.gov/DRS/Pass-Through-Entity/PE-Tax-Information",
  },
];

const DC: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "DC",
    formCode: "DC-D-40",
    title: "DC Form D-40 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionFormCode: "FR-127",
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://otr.cfo.dc.gov/page/individual-income-tax-forms",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "DC",
    formCode: "DC-D-20",
    title: "DC Form D-20 — Corporation Franchise Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://otr.cfo.dc.gov/page/corporate-franchise-tax-forms",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "DC",
    formCode: "DC-D-30",
    title: "DC Form D-30 — Unincorporated Business Franchise Tax",
    description: "DC taxes unincorporated businesses (LLCs, partnerships, sole props) at the entity level",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://otr.cfo.dc.gov/page/unincorporated-business-franchise-tax-forms",
  },
];

const HAWAII: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "HI",
    formCode: "HI-N-11",
    title: "HI Form N-11 — Individual Income Tax",
    description: "All HI returns due 4/20 — five days after federal",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 20, yearOffset: 1 },
    extensionPayload: { month: 10, day: 20, yearOffset: 1 },
    sourceUrl: "https://tax.hawaii.gov/forms/d_indiv/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "HI",
    formCode: "HI-N-30",
    title: "HI Form N-30 — Corporation Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 20, yearOffset: 1 },
    extensionPayload: { month: 10, day: 20, yearOffset: 1 },
    sourceUrl: "https://tax.hawaii.gov/forms/d_corp/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "HI",
    formCode: "HI-N-35",
    title: "HI Form N-35 — S-Corporation Income Tax",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 20, yearOffset: 1 },
    extensionPayload: { month: 10, day: 20, yearOffset: 1 },
    sourceUrl: "https://tax.hawaii.gov/forms/d_corp/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "HI",
    formCode: "HI-N-20",
    title: "HI Form N-20 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 20, yearOffset: 1 },
    extensionPayload: { month: 10, day: 20, yearOffset: 1 },
    sourceUrl: "https://tax.hawaii.gov/forms/d_part/",
  },
];

const IDAHO: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "ID",
    formCode: "ID-40",
    title: "ID Form 40 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.idaho.gov/taxes/income-tax/individual/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "ID",
    formCode: "ID-41",
    title: "ID Form 41 — C-Corporation Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.idaho.gov/taxes/income-tax/business/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "ID",
    formCode: "ID-41S",
    title: "ID Form 41S — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.idaho.gov/taxes/income-tax/business/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "ID",
    formCode: "ID-65",
    title: "ID Form 65 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.idaho.gov/taxes/income-tax/business/",
  },
];

const INDIANA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "IN",
    formCode: "IN-IT-40",
    title: "IN Form IT-40 — Individual Income Tax",
    description: "IN gives an automatic 7-month extension (not 6) — to 11/15 for calendar year",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 11, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.in.gov/dor/individual-income-taxes/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "IN",
    formCode: "IN-IT-20",
    title: "IN Form IT-20 — C-Corporation Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 11, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.in.gov/dor/business-tax/corporate-income-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "IN",
    formCode: "IN-IT-20S",
    title: "IN Form IT-20S — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.in.gov/dor/business-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "IN",
    formCode: "IN-IT-65",
    title: "IN Form IT-65 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.in.gov/dor/business-tax/",
  },
];

const IOWA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "IA",
    formCode: "IA-1040",
    title: "IA Form IA 1040 — Individual Income Tax",
    description: "IA individual return due 4/30 — 15 days after federal",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 30, yearOffset: 1 },
    extensionPayload: { month: 10, day: 31, yearOffset: 1 },
    sourceUrl: "https://revenue.iowa.gov/taxes/tax-guidance/individual-income-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "IA",
    formCode: "IA-1120",
    title: "IA Form IA 1120 — C-Corporation Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 30, yearOffset: 1 },
    extensionPayload: { month: 10, day: 31, yearOffset: 1 },
    sourceUrl: "https://revenue.iowa.gov/taxes/tax-guidance/business-taxes/corporate-income-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "IA",
    formCode: "IA-1120S",
    title: "IA Form IA 1120S — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 31, yearOffset: 1 },
    extensionPayload: { month: 9, day: 30, yearOffset: 1 },
    sourceUrl: "https://revenue.iowa.gov/taxes/tax-guidance/business-taxes",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "IA",
    formCode: "IA-1065",
    title: "IA Form IA 1065 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 30, yearOffset: 1 },
    extensionPayload: { month: 10, day: 31, yearOffset: 1 },
    sourceUrl: "https://revenue.iowa.gov/taxes/tax-guidance/business-taxes",
  },
];

const KANSAS: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "KS",
    formCode: "KS-K-40",
    title: "KS Form K-40 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ksrevenue.gov/perstaxtypesii.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "KS",
    formCode: "KS-K-120",
    title: "KS Form K-120 — Corporate Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ksrevenue.gov/bustaxtypesctaxctaxhome.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "KS",
    formCode: "KS-K-120S",
    title: "KS Form K-120S — Partnership / S-Corporation",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.ksrevenue.gov/bustaxtypesctaxctaxhome.html",
  },
];

const KENTUCKY: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "KY",
    formCode: "KY-740",
    title: "KY Form 740 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://revenue.ky.gov/Individual/Pages/default.aspx",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "KY",
    formCode: "KY-720",
    title: "KY Form 720 — Corporation Income & LLET",
    description: "KY corporations also pay Limited Liability Entity Tax (LLET) on the same return",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://revenue.ky.gov/Business/Corporation-Income-and-Limited-Liability-Entity-Tax/Pages/default.aspx",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "KY",
    formCode: "KY-PTE",
    title: "KY Form PTE — Pass-Through Entity Return",
    description: "Combined S-corp + partnership return; LLET applies even when no income tax owed",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://revenue.ky.gov/Business/Pages/Pass-Through-Entities.aspx",
  },
];

const LOUISIANA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "LA",
    formCode: "LA-IT-540",
    title: "LA Form IT-540 — Individual Income Tax",
    description: "All LA returns due 5/15 (1 month after federal); extension to 11/15",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 5, day: 15, yearOffset: 1 },
    extensionPayload: { month: 11, day: 15, yearOffset: 1 },
    sourceUrl: "https://revenue.louisiana.gov/individualincometax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "LA",
    formCode: "LA-CIFT-620",
    title: "LA Form CIFT-620 — Corporation Income & Franchise Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 5, day: 15, yearOffset: 1 },
    extensionPayload: { month: 11, day: 15, yearOffset: 1 },
    sourceUrl: "https://revenue.louisiana.gov/businesses/tax-types/coporate-income-franchise-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "LA",
    formCode: "LA-IT-565",
    title: "LA Form IT-565 — Partnership Income Tax",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 5, day: 15, yearOffset: 1 },
    extensionPayload: { month: 11, day: 15, yearOffset: 1 },
    sourceUrl: "https://revenue.louisiana.gov/businesses/tax-types/partnership/",
  },
];

const MAINE: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "ME",
    formCode: "ME-1040ME",
    title: "ME Form 1040ME — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.maine.gov/revenue/taxes/income-estate-tax/individual-income-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "ME",
    formCode: "ME-1120ME",
    title: "ME Form 1120ME — Corporate Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.maine.gov/revenue/taxes/income-estate-tax/corporate-income-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "ME",
    formCode: "ME-1065ME-1120S-ME",
    title: "ME Form 1065ME / 1120S-ME — Partnership / S-Corporation",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.maine.gov/revenue/taxes/income-estate-tax/pass-through-entities",
  },
];

const MARYLAND: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "MD",
    formCode: "MD-502",
    title: "MD Form 502 — Resident Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.marylandtaxes.gov/individual/index.php",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MD",
    formCode: "MD-500",
    title: "MD Form 500 — Corporation Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.marylandtaxes.gov/business/income/index.php",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MD",
    formCode: "MD-510",
    title: "MD Form 510 — Pass-Through Entity Income Tax",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.marylandtaxes.gov/business/pass-through-entity/index.php",
  },
];

const MICHIGAN: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "MI",
    formCode: "MI-1040",
    title: "MI Form MI-1040 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.michigan.gov/taxes/iit",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MI",
    formCode: "MI-4891",
    title: "MI Form 4891 — Corporate Income Tax (CIT)",
    description: "MI CIT applies only to C-corps; pass-throughs flow to individual returns",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 30, yearOffset: 1 },
    extensionPayload: { month: 10, day: 31, yearOffset: 1 },
    sourceUrl: "https://www.michigan.gov/taxes/business-taxes/cit",
  },
];

const MINNESOTA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "MN",
    formCode: "MN-M1",
    title: "MN Form M1 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.state.mn.us/individuals",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MN",
    formCode: "MN-M4",
    title: "MN Form M4 — Corporation Franchise Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 11, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.state.mn.us/corporation-franchise-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MN",
    formCode: "MN-M8",
    title: "MN Form M8 — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.state.mn.us/s-corporation-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MN",
    formCode: "MN-M3",
    title: "MN Form M3 — Partnership Tax",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.state.mn.us/partnership-tax",
  },
];

const MISSISSIPPI: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "MS",
    formCode: "MS-80-105",
    title: "MS Form 80-105 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.dor.ms.gov/individual",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MS",
    formCode: "MS-83-105",
    title: "MS Form 83-105 — Corporate Income & Franchise Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.dor.ms.gov/business",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MS",
    formCode: "MS-84-105",
    title: "MS Form 84-105 — Pass-Through Entity",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.dor.ms.gov/business",
  },
];

const MISSOURI: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "MO",
    formCode: "MO-1040",
    title: "MO Form MO-1040 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.mo.gov/personal/individual/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MO",
    formCode: "MO-1120",
    title: "MO Form MO-1120 — Corporation Income & Franchise Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.mo.gov/taxation/business/tax-types/corporation/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MO",
    formCode: "MO-1120S",
    title: "MO Form MO-1120S — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.mo.gov/taxation/business/tax-types/corporation/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MO",
    formCode: "MO-1065",
    title: "MO Form MO-1065 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.mo.gov/taxation/business/tax-types/partnership/",
  },
];

const MONTANA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "MT",
    formCode: "MT-FORM-2",
    title: "MT Form 2 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://mtrevenue.gov/taxes/individual-income-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MT",
    formCode: "MT-CIT",
    title: "MT Form CIT — Corporate Income Tax",
    description: "MT CIT due 5/15 — 15th day of 5th month after FYE for calendar year filers",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 5, day: 15, yearOffset: 1 },
    extensionPayload: { month: 11, day: 15, yearOffset: 1 },
    sourceUrl: "https://mtrevenue.gov/taxes/corporate-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "MT",
    formCode: "MT-PTE",
    title: "MT Form PTE — Pass-Through Entity Return",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://mtrevenue.gov/taxes/pass-through-entities/",
  },
];

const NEBRASKA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "NE",
    formCode: "NE-1040N",
    title: "NE Form 1040N — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://revenue.nebraska.gov/individuals/individual-income-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NE",
    formCode: "NE-1120N",
    title: "NE Form 1120N — Corporation Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://revenue.nebraska.gov/businesses/corporation-income-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NE",
    formCode: "NE-1120-SN",
    title: "NE Form 1120-SN — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://revenue.nebraska.gov/businesses",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NE",
    formCode: "NE-1065N",
    title: "NE Form 1065N — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://revenue.nebraska.gov/businesses",
  },
];

const NEVADA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "NV",
    formCode: "NV-COMMERCE-TAX",
    title: "NV Commerce Tax — Annual Return",
    description: "NV has no income tax. Commerce Tax applies to businesses with NV gross revenue > $4M, due 8/15 (45 days after fiscal year end 6/30)",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 8, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.nv.gov/Commerce/Commerce_Tax/",
  },
];

const NEW_HAMPSHIRE: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "NH",
    formCode: "NH-BPT-NH-1120",
    title: "NH Form NH-1120 — Business Profits Tax",
    description: "NH has no general income tax. BPT applies to businesses (incl. sole props with NH gross > $103K). I&D tax repealed for tax years after 2024",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.nh.gov/forms/business-profits.htm",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NH",
    formCode: "NH-BET",
    title: "NH Business Enterprise Tax",
    description: "0.55% on enterprise value tax base; filed alongside BPT",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.nh.gov/forms/business-enterprise.htm",
  },
];

const NEW_MEXICO: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "NM",
    formCode: "NM-PIT-1",
    title: "NM Form PIT-1 — Personal Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.newmexico.gov/individuals/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NM",
    formCode: "NM-CIT-1",
    title: "NM Form CIT-1 — Corporate Income & Franchise Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.newmexico.gov/businesses/corporate-income-franchise-tax/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "NM",
    formCode: "NM-PTE",
    title: "NM Form PTE — Pass-Through Entity Information",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.newmexico.gov/businesses/pass-through-entity/",
  },
];

const NORTH_DAKOTA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "ND",
    formCode: "ND-1",
    title: "ND Form ND-1 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.nd.gov/individual",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "ND",
    formCode: "ND-40",
    title: "ND Form 40 — Corporation Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.nd.gov/business/corporation-income-tax",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "ND",
    formCode: "ND-60",
    title: "ND Form 60 — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.nd.gov/business",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "ND",
    formCode: "ND-58",
    title: "ND Form 58 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tax.nd.gov/business",
  },
];

const OKLAHOMA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "OK",
    formCode: "OK-511",
    title: "OK Form 511 — Resident Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://oklahoma.gov/tax/individuals/income-tax.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "OK",
    formCode: "OK-512",
    title: "OK Form 512 — Corporation Income & Franchise Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://oklahoma.gov/tax/businesses/corporate-tax.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "OK",
    formCode: "OK-512-S",
    title: "OK Form 512-S — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://oklahoma.gov/tax/businesses.html",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "OK",
    formCode: "OK-514",
    title: "OK Form 514 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://oklahoma.gov/tax/businesses.html",
  },
];

const OREGON: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "OR",
    formCode: "OR-OR-40",
    title: "OR Form OR-40 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.oregon.gov/dor/programs/individuals/Pages/default.aspx",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "OR",
    formCode: "OR-OR-20",
    title: "OR Form OR-20 — Corporation Excise / Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.oregon.gov/dor/programs/businesses/Pages/corp-tax.aspx",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "OR",
    formCode: "OR-OR-20-S",
    title: "OR Form OR-20-S — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.oregon.gov/dor/programs/businesses/Pages/corp-tax.aspx",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "OR",
    formCode: "OR-OR-65",
    title: "OR Form OR-65 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.oregon.gov/dor/programs/businesses/Pages/partnership.aspx",
  },
];

const RHODE_ISLAND: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "RI",
    formCode: "RI-1040",
    title: "RI Form RI-1040 — Resident Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.ri.gov/forms/individual-tax-forms",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "RI",
    formCode: "RI-1120C",
    title: "RI Form RI-1120C — Business Corporation Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.ri.gov/forms/business-tax-forms/corporate-tax-forms",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "RI",
    formCode: "RI-1120S",
    title: "RI Form RI-1120S — Subchapter S",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.ri.gov/forms/business-tax-forms/corporate-tax-forms",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "RI",
    formCode: "RI-1065",
    title: "RI Form RI-1065 — Partnership Income Tax",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.ri.gov/forms/business-tax-forms/partnership-tax-forms",
  },
];

const SOUTH_CAROLINA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "SC",
    formCode: "SC-SC1040",
    title: "SC Form SC1040 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.sc.gov/tax/individual-income",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "SC",
    formCode: "SC-SC1120",
    title: "SC Form SC1120 — C-Corporation Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.sc.gov/tax/corporate",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "SC",
    formCode: "SC-SC1120S",
    title: "SC Form SC1120S — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.sc.gov/tax/corporate",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "SC",
    formCode: "SC-SC1065",
    title: "SC Form SC1065 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://dor.sc.gov/tax/partnership",
  },
];

const SOUTH_DAKOTA: SeedRule[] = [
  // SD has no individual or corporate income tax; bank franchise tax
  // applies only to financial institutions. Most CPA clients in SD have
  // zero state-level filing obligations beyond federal.
];

const TENNESSEE: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "TN",
    formCode: "TN-FAE-170",
    title: "TN Form FAE 170 — Franchise & Excise Tax",
    description: "TN has no individual income tax (Hall Tax repealed 2021). F&E applies to most entities including LLCs",
    entityTypes: ["c_corp", "s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 11, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.tn.gov/revenue/taxes/franchise---excise-tax.html",
  },
];

const UTAH: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "UT",
    formCode: "UT-TC-40",
    title: "UT Form TC-40 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://incometax.utah.gov/",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "UT",
    formCode: "UT-TC-20",
    title: "UT Form TC-20 — Corporation Franchise & Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.utah.gov/forms/current/tc-20inst.pdf",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "UT",
    formCode: "UT-TC-20S",
    title: "UT Form TC-20S — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.utah.gov/forms/current/tc-20sinst.pdf",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "UT",
    formCode: "UT-TC-65",
    title: "UT Form TC-65 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.utah.gov/forms/current/tc-65inst.pdf",
  },
];

const VERMONT: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "VT",
    formCode: "VT-IN-111",
    title: "VT Form IN-111 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.vermont.gov/individuals",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "VT",
    formCode: "VT-CO-411",
    title: "VT Form CO-411 — Corporate Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.vermont.gov/business/corporate",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "VT",
    formCode: "VT-BI-471",
    title: "VT Form BI-471 — Business Income Tax (S-Corp / Partnership)",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.vermont.gov/business/business-entity-tax",
  },
];

const WEST_VIRGINIA: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "WV",
    formCode: "WV-IT-140",
    title: "WV Form IT-140 — Personal Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.wv.gov/Individuals/Pages/default.aspx",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "WV",
    formCode: "WV-CIT-120",
    title: "WV Form CIT-120 — Corporation Net Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.wv.gov/Business/CorporateNetIncome/Pages/default.aspx",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "WV",
    formCode: "WV-PTE-100",
    title: "WV Form PTE-100 — Pass-Through Entity",
    entityTypes: ["s_corp", "partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://tax.wv.gov/Business/PassThroughEntity/Pages/default.aspx",
  },
];

const WISCONSIN: SeedRule[] = [
  {
    jurisdictionType: "state",
    jurisdictionCode: "WI",
    formCode: "WI-FORM-1",
    title: "WI Form 1 — Individual Income Tax",
    entityTypes: ["individual"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.wi.gov/Pages/Individuals/home.aspx",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "WI",
    formCode: "WI-FORM-4",
    title: "WI Form 4 — Corporation Franchise / Income Tax",
    entityTypes: ["c_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 4, day: 15, yearOffset: 1 },
    extensionPayload: { month: 10, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.wi.gov/Pages/Businesses/Corporation.aspx",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "WI",
    formCode: "WI-FORM-5S",
    title: "WI Form 5S — S-Corporation",
    entityTypes: ["s_corp"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.wi.gov/Pages/Businesses/Corporation.aspx",
  },
  {
    jurisdictionType: "state",
    jurisdictionCode: "WI",
    formCode: "WI-FORM-3",
    title: "WI Form 3 — Partnership Return",
    entityTypes: ["partnership", "llc"],
    ruleType: "fixed_date",
    rulePayload: { month: 3, day: 15, yearOffset: 1 },
    extensionPayload: { month: 9, day: 15, yearOffset: 1 },
    sourceUrl: "https://www.revenue.wi.gov/Pages/Businesses/Partnership.aspx",
  },
];

const WYOMING: SeedRule[] = [
  // WY has no individual income tax, no corporate income tax, no
  // franchise tax on most entities. Federal filings are the only
  // tax obligation for typical CPA clients.
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
  // Round 8b: Tier 2 states (top GDP / CPA client density after Tier 1)
  ...PENNSYLVANIA,
  ...ILLINOIS,
  ...OHIO,
  ...GEORGIA,
  ...MASSACHUSETTS,
  ...VIRGINIA,
  ...WASHINGTON,
  ...ARIZONA,
  ...NORTH_CAROLINA,
  ...FLORIDA,
  // Round 9: remaining 36 jurisdictions to bring coverage to 50 + DC
  ...ALABAMA,
  ...ALASKA,
  ...ARKANSAS,
  ...COLORADO,
  ...CONNECTICUT,
  ...DC,
  ...HAWAII,
  ...IDAHO,
  ...INDIANA,
  ...IOWA,
  ...KANSAS,
  ...KENTUCKY,
  ...LOUISIANA,
  ...MAINE,
  ...MARYLAND,
  ...MICHIGAN,
  ...MINNESOTA,
  ...MISSISSIPPI,
  ...MISSOURI,
  ...MONTANA,
  ...NEBRASKA,
  ...NEVADA,
  ...NEW_HAMPSHIRE,
  ...NEW_MEXICO,
  ...NORTH_DAKOTA,
  ...OKLAHOMA,
  ...OREGON,
  ...RHODE_ISLAND,
  ...SOUTH_CAROLINA,
  ...SOUTH_DAKOTA,
  ...TENNESSEE,
  ...UTAH,
  ...VERMONT,
  ...WEST_VIRGINIA,
  ...WISCONSIN,
  ...WYOMING,
];

// ---------------------------------------------------------------------------
// Service groups — bundles of rules that get applied as a unit when an
// entity is onboarded. Org_id is NULL for built-in services (every firm
// uses them).
//
// `defaultForEntityTypes` controls which entity types get this service
// auto-checked in the entity-creation form. Empty array = always opt-in
// (the CPA explicitly adds it; e.g. "Quarterly Payroll" only matters for
// employers, regardless of entity type).
//
// `formCodeFilter` is local to this seed script. The rule list is
// resolved at seed-time: any rule whose form_code starts with one of
// the prefixes (or matches exactly) gets attached to the service. This
// lets us avoid hand-listing every state form when a service like
// "Personal Tax Filing" should naturally include both federal 1040 and
// every state 1040-equivalent.
// ---------------------------------------------------------------------------

type SeedService = {
  slug: string;
  name: string;
  description: string;
  defaultForEntityTypes: EntityType[];
  sortOrder: number;
  /** Rules selected by exact form_code match. */
  formCodes?: string[];
  /** Rules selected by form_code prefix (e.g. "1040-ES" picks Q1-Q4). */
  formCodePrefixes?: string[];
};

const SERVICES: SeedService[] = [
  {
    slug: "personal_tax",
    name: "Personal Tax Filing",
    description:
      "Federal Form 1040 and state equivalents, including quarterly estimated tax. Default for individuals.",
    defaultForEntityTypes: ["individual"],
    sortOrder: 10,
    formCodes: [
      "1040",
      "CA-540",
      "NY-IT-201",
      "NJ-1040",
      "PA-40",
      "IL-1040",
      "IT 1040",
      "GA-500",
      "MA-1",
      "VA-760",
      "AZ-140",
      "NC-D-400",
      "DE-PIT-RES",
    ],
    formCodePrefixes: ["1040-ES", "CA-540-ES"],
  },
  {
    slug: "c_corp_tax",
    name: "C-Corporation Tax Filing",
    description:
      "Federal Form 1120 and state corporate income tax returns.",
    defaultForEntityTypes: ["c_corp"],
    sortOrder: 20,
    formCodes: [
      "1120",
      "CA-100",
      "NY-CT-3",
      "NJ-CBT-100",
      "RCT-101",
      "IL-1120",
      "GA-600",
      "MA-355",
      "VA-500",
      "AZ-120",
      "NC-CD-405",
      "DE-1100",
      "FL-F-1120",
      "TX-Franchise",
      "TX-PIR",
      "WA-BO-ANNUAL",
    ],
  },
  {
    slug: "s_corp_tax",
    name: "S-Corporation Tax Filing",
    description: "Federal Form 1120-S and state S-corp returns.",
    defaultForEntityTypes: ["s_corp"],
    sortOrder: 30,
    formCodes: [
      "1120-S",
      "CA-100S",
      "NY-CT-3-S",
      "NJ-CBT-100S",
      "IL-1120-ST",
      "GA-600S",
      "MA-355S",
      "AZ-120S",
      "NC-CD-401S",
      "DE-1100-S",
    ],
  },
  {
    slug: "partnership_tax",
    name: "Partnership / LLC Tax Filing",
    description:
      "Federal Form 1065 and state partnership/LLC returns. Use this for partnerships and LLCs taxed as partnerships.",
    defaultForEntityTypes: ["partnership", "llc"],
    sortOrder: 40,
    formCodes: [
      "1065",
      "CA-568",
      "CA-3522",
      "NY-IT-204",
      "NY-IT-204-LL",
      "NJ-1065",
      "PA-20S/PA-65",
      "IL-1065",
      "IT 4708",
      "GA-700",
      "MA-3",
      "VA-502",
      "AZ-165",
      "NC-D-403",
      "DE-300",
      "DE-LLC-300",
      "DE-Franchise-Corp",
      "FL-F-1065",
    ],
  },
  {
    slug: "trust_estate_tax",
    name: "Trust & Estate Filing",
    description: "Federal Form 1041 for trusts and estates.",
    defaultForEntityTypes: ["trust", "estate"],
    sortOrder: 50,
    formCodes: ["1041"],
  },
  {
    slug: "nonprofit_tax",
    name: "Nonprofit Annual Filing",
    description: "Federal Form 990 and state nonprofit returns.",
    defaultForEntityTypes: ["nonprofit"],
    sortOrder: 60,
    formCodes: ["990"],
  },
  {
    slug: "quarterly_payroll",
    name: "Quarterly Payroll",
    description:
      "Form 941 quarterly federal payroll tax (Apr 30 / Jul 31 / Oct 31 / Jan 31). Add for any client with W-2 employees.",
    defaultForEntityTypes: [], // opt-in only — not every entity has employees
    sortOrder: 70,
    formCodePrefixes: ["941-Q"],
  },
  {
    slug: "annual_payroll",
    name: "Annual Payroll & Info Returns",
    description:
      "W-2 / W-3, Form 940 (FUTA), and 1099-NEC / 1099-MISC. The January-31 cluster every employer faces.",
    defaultForEntityTypes: [],
    sortOrder: 80,
    formCodes: ["940", "W-2", "W-3", "1099-NEC", "1099-MISC"],
  },
  {
    slug: "retirement_plan",
    name: "Retirement Plan (5500)",
    description:
      "Form 5500 annual return for clients with 401(k), pension, or other ERISA-covered plans.",
    defaultForEntityTypes: [],
    sortOrder: 90,
    formCodes: ["5500"],
  },
  {
    slug: "ptet",
    name: "PTE Election (Pass-Through Entity Tax)",
    description:
      "State PTE elections — the SALT-cap workaround filings (NY-PTET, CA-3893, etc.). Add for partnerships or S-corps that elect.",
    defaultForEntityTypes: [],
    sortOrder: 100,
    formCodes: [
      "NY-PTET",
      "CA-3893",
      "NJ-PTE",
      "GA-PTE-ELECT",
      "MA-63D-ELT",
      "VA-502PTET",
      "AZ-PTE-ELECT",
      "NC-PTE-ELECT",
      "IT 4738",
    ],
  },
  {
    slug: "foreign_account",
    name: "Foreign Account Reporting (FBAR)",
    description:
      "FinCEN-114 (FBAR) for clients with foreign bank accounts aggregating over $10,000.",
    defaultForEntityTypes: [],
    sortOrder: 110,
    formCodes: ["FinCEN-114"],
  },
];

/** Resolve which rule IDs match a service's form-code criteria. */
async function resolveServiceRuleIds(svc: SeedService): Promise<string[]> {
  const exactMatches: string[] = [];
  if (svc.formCodes && svc.formCodes.length > 0) {
    const rows = await db
      .select({ id: deadlineRules.id })
      .from(deadlineRules)
      .where(inArray(deadlineRules.formCode, svc.formCodes));
    exactMatches.push(...rows.map((r) => r.id));
  }

  const prefixMatches: string[] = [];
  if (svc.formCodePrefixes && svc.formCodePrefixes.length > 0) {
    for (const prefix of svc.formCodePrefixes) {
      const rows = await db
        .select({ id: deadlineRules.id })
        .from(deadlineRules)
        .where(sql`${deadlineRules.formCode} LIKE ${prefix + "%"}`);
      prefixMatches.push(...rows.map((r) => r.id));
    }
  }

  // Dedupe — a rule could match both an exact and a prefix entry.
  return Array.from(new Set([...exactMatches, ...prefixMatches]));
}

/**
 * Idempotent service-group seeding. Built-in services are identified by
 * (slug, org_id IS NULL) — re-running updates name/description/sortOrder
 * but doesn't disturb firm-customized services or entity assignments.
 *
 * Rule mappings are fully replaced on each run: drop all existing
 * `service_group_rules` for the built-in service, re-insert from the
 * resolved form-code criteria. Safe because rules CAN be re-attached
 * cheaply and an entity's deadlines are materialized eagerly anyway —
 * existing deadline_instances aren't affected by service-rule edits.
 */
async function seedServiceGroups(): Promise<void> {
  console.log(`Seeding ${SERVICES.length} built-in service groups…`);

  let upserted = 0;
  let totalRulesAttached = 0;

  for (const svc of SERVICES) {
    // Upsert the service row keyed on (slug, org_id IS NULL).
    const existing = await db
      .select({ id: serviceGroups.id })
      .from(serviceGroups)
      .where(
        and(eq(serviceGroups.slug, svc.slug), isNull(serviceGroups.orgId)),
      )
      .limit(1);

    let serviceId: string;
    if (existing[0]) {
      serviceId = existing[0].id;
      await db
        .update(serviceGroups)
        .set({
          name: svc.name,
          description: svc.description,
          defaultForEntityTypes: svc.defaultForEntityTypes,
          sortOrder: svc.sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(serviceGroups.id, serviceId));
    } else {
      const [row] = await db
        .insert(serviceGroups)
        .values({
          orgId: null,
          slug: svc.slug,
          name: svc.name,
          description: svc.description,
          defaultForEntityTypes: svc.defaultForEntityTypes,
          sortOrder: svc.sortOrder,
        })
        .returning({ id: serviceGroups.id });
      serviceId = row.id;
    }
    upserted++;

    // Replace the rule mapping. Quick + simple; the table is small.
    await db
      .delete(serviceGroupRules)
      .where(eq(serviceGroupRules.serviceGroupId, serviceId));

    const ruleIds = await resolveServiceRuleIds(svc);
    if (ruleIds.length > 0) {
      await db.insert(serviceGroupRules).values(
        ruleIds.map((ruleId) => ({
          serviceGroupId: serviceId,
          ruleId,
        })),
      );
    }
    totalRulesAttached += ruleIds.length;
    console.log(`  ✓ ${svc.slug} → ${ruleIds.length} rules`);
  }

  console.log(
    `✅ Upserted ${upserted} services with ${totalRulesAttached} total rule attachments.`,
  );
}

async function main() {
  console.log(`Seeding ${ALL_RULES.length} deadline rules…`);
  const EFFECTIVE_FROM = "2025-01-01";

  // Check which rules are already present (by jurisdiction + form_code + title + version)
  const existing = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*) as count FROM deadline_rules`,
  );
  console.log(`  Existing rules in DB: ${existing.rows[0]?.count ?? 0}`);

  // We onConflictDoUpdate on the payload + meta fields. This makes the
  // seed idempotent in both directions: new rules get inserted, and
  // changes to existing rules (e.g. switching 1120 from absolute Apr 15
  // to fyeMonthOffset=4) actually take effect on re-run. We do NOT
  // touch firm-level overrides — there aren't any yet (V2 territory),
  // and when they exist they'll live in a separate `deadline_rule_overrides`
  // table.
  let touched = 0;
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
        requiresElection: rule.requiresElection ?? null,
      })
      .onConflictDoUpdate({
        // Match the natural-key unique index on these columns.
        target: [
          deadlineRules.jurisdictionCode,
          deadlineRules.formCode,
          deadlineRules.title,
          deadlineRules.version,
        ],
        set: {
          description: rule.description,
          entityTypes: rule.entityTypes,
          ruleType: rule.ruleType,
          rulePayload: rule.rulePayload as Record<string, unknown>,
          extensionFormCode: rule.extensionFormCode,
          extensionPayload: rule.extensionPayload as
            | Record<string, unknown>
            | undefined,
          penaltySummary: rule.penaltySummary,
          sourceUrl: rule.sourceUrl,
          irrevocable: rule.irrevocable ?? false,
          requiresElection: rule.requiresElection ?? null,
        },
      })
      .returning({
        id: deadlineRules.id,
        // xmin trick: returns the row's transaction id, lets us tell
        // INSERT (xmin = current txn) from UPDATE (xmin = earlier).
        // Cheaper than a second query.
      });

    if (result.length > 0) touched += 1;
  }

  console.log(`✅ Upserted ${touched} rules.`);
  const uniqueJurisdictions = new Set(ALL_RULES.map((r) => r.jurisdictionCode));
  console.log(
    `   Total: ${ALL_RULES.length} rules across ${uniqueJurisdictions.size} jurisdictions.`,
  );

  // Service groups depend on rules existing first, so seed them last.
  await seedServiceGroups();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
