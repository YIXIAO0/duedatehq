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
  const uniqueJurisdictions = new Set(ALL_RULES.map((r) => r.jurisdictionCode));
  console.log(
    `   Total: ${ALL_RULES.length} rules across ${uniqueJurisdictions.size} jurisdictions.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
