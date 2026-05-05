/**
 * Generate a realistic mock client list for testing the import flow.
 *
 * Scenario: Grace's small CPA firm (Austin TX) — staff accountant managing
 * 70 clients across 3 senior CPAs. Includes a Florida cohort (LLCs in
 * Hillsborough / Tampa Bay) so the live-demo IRS disaster-relief flow has
 * something to filter against.
 *
 * 70 rows with deliberate messiness to stress-test AI column mapping:
 *   - Ambiguous column names ("Client" not "Client Name", "Type" not "Entity Type")
 *   - Messy entity type strings ("S-Corp", "S corp", "1120-S", "Indiv.")
 *   - Full state names mixed with codes ("California" vs "CA")
 *   - Multi-state operating in "Also Files In" column
 *   - A few rows with intentional edge cases (missing name, invalid email)
 *
 * Run: pnpm tsx scripts/generate-mock-clients.ts
 * Output: /Users/yxiao/Desktop/yi/work/DueDateHQ/mock-clients.xlsx
 *         /Users/yxiao/Desktop/yi/work/DueDateHQ/mock-clients.csv
 */

import * as XLSX from "xlsx";
import * as fs from "node:fs";
import * as path from "node:path";

type Row = {
  "Client": string;
  "Type": string;
  "State": string;
  "Also Files In": string;
  "EIN": string;
  "Email": string;
  "Phone": string;
  "Notes": string;
};

const ROWS: Row[] = [
  // ---- Individuals (~10) ----
  {
    Client: "John & Jane Smith",
    Type: "Individual",
    State: "NY",
    "Also Files In": "",
    EIN: "",
    Email: "jsmith@example.com",
    Phone: "(212) 555-0101",
    Notes: "Filed jointly last 3 years. NY PTET opted in via his LLC.",
  },
  {
    Client: "Rachel Chen",
    Type: "Individual",
    State: "California",
    "Also Files In": "NY",
    EIN: "",
    Email: "rachel.chen@example.com",
    Phone: "(415) 555-0102",
    Notes: "Moved from NY to CA in 2023. Partial-year NY return.",
  },
  {
    Client: "Maria Rodriguez",
    Type: "Indiv.",
    State: "TX",
    "Also Files In": "",
    EIN: "",
    Email: "mrodriguez@example.com",
    Phone: "(512) 555-0103",
    Notes: "Single filer, no dependents.",
  },
  {
    Client: "David Kim",
    Type: "individual",
    State: "NJ",
    "Also Files In": "NY",
    EIN: "",
    Email: "dkim@example.com",
    Phone: "",
    Notes: "NJ resident, works in NYC. NJ credit for NYS tax paid.",
  },
  {
    Client: "Lisa Thompson",
    Type: "1040",
    State: "FL",
    "Also Files In": "",
    EIN: "",
    Email: "lthompson@example.com",
    Phone: "(305) 555-0105",
    Notes: "FL resident — no state return needed.",
  },
  {
    Client: "Michael O'Brien",
    Type: "Individual",
    State: "NY",
    "Also Files In": "NJ, CT",
    EIN: "",
    Email: "mobrien@example.com",
    Phone: "(646) 555-0106",
    Notes: "Traveling attorney — multi-state apportionment.",
  },
  {
    Client: "Priya Patel",
    Type: "Person",
    State: "CA",
    "Also Files In": "",
    EIN: "",
    Email: "ppatel@example.com",
    Phone: "(408) 555-0107",
    Notes: "Tech worker, RSU income — complex AMT.",
  },
  {
    Client: "Robert Wilson",
    Type: "Individual",
    State: "DE",
    "Also Files In": "",
    EIN: "",
    Email: "rwilson@example.com",
    Phone: "(302) 555-0108",
    Notes: "Retired, trust beneficiary.",
  },
  {
    Client: "Sarah Martinez",
    Type: "Individual",
    State: "TX",
    "Also Files In": "CA",
    EIN: "",
    Email: "smartinez@example.com",
    Phone: "(713) 555-0109",
    Notes: "Remote CA contractor, lives in TX.",
  },
  {
    Client: "James Park",
    Type: "Sole Proprietor",
    State: "NY",
    "Also Files In": "",
    EIN: "",
    Email: "jpark@example.com",
    Phone: "(917) 555-0110",
    Notes: "Schedule C freelance designer.",
  },
  {
    Client: "Aisha Williams",
    Type: "Individual",
    State: "GA",
    "Also Files In": "FL",
    EIN: "",
    Email: "awilliams@example.com",
    Phone: "(404) 555-0111",
    Notes: "ATL-based attorney with FL property income.",
  },
  {
    Client: "Carlos Hernandez",
    Type: "Indiv.",
    State: "AZ",
    "Also Files In": "",
    EIN: "",
    Email: "chernandez@example.com",
    Phone: "(602) 555-0112",
    Notes: "AZ resident, Schedule C consulting.",
  },
  {
    Client: "Emily Wong",
    Type: "1040",
    State: "WA",
    "Also Files In": "OR",
    EIN: "",
    Email: "ewong@example.com",
    Phone: "(206) 555-0113",
    Notes: "WA resident, OR partial-year — pandemic relocation.",
  },
  {
    Client: "Marcus Johnson",
    Type: "Individual",
    State: "MA",
    "Also Files In": "",
    EIN: "",
    Email: "mjohnson@example.com",
    Phone: "(617) 555-0114",
    Notes: "Boston-based banker, deferred comp + RSUs.",
  },
  {
    Client: "Sofia Greco",
    Type: "Individual",
    State: "IL",
    "Also Files In": "WI",
    EIN: "",
    Email: "sgreco@example.com",
    Phone: "(312) 555-0115",
    Notes: "IL/WI border, works remote.",
  },
  {
    Client: "Brandon Taylor",
    Type: "Person",
    State: "CO",
    "Also Files In": "",
    EIN: "",
    Email: "btaylor@example.com",
    Phone: "(303) 555-0116",
    Notes: "CO resident, 1099 ski instructor seasonal.",
  },
  {
    Client: "Mei-Ling Tan",
    Type: "Individual",
    State: "VA",
    "Also Files In": "DC, MD",
    EIN: "",
    Email: "mtan@example.com",
    Phone: "(703) 555-0117",
    Notes: "Federal contractor, DMV multi-jurisdiction.",
  },
  {
    Client: "Hassan Al-Mahmoud",
    Type: "Individual",
    State: "MI",
    "Also Files In": "",
    EIN: "",
    Email: "halmahmoud@example.com",
    Phone: "(313) 555-0118",
    Notes: "Detroit physician, S-Corp + W-2 mix.",
  },
  {
    Client: "Jasmine Brooks",
    Type: "Sole Proprietor",
    State: "NC",
    "Also Files In": "",
    EIN: "",
    Email: "jbrooks@example.com",
    Phone: "(704) 555-0119",
    Notes: "Schedule C: photography studio.",
  },
  {
    Client: "Ethan Goldberg",
    Type: "Individual",
    State: "PA",
    "Also Files In": "NJ",
    EIN: "",
    Email: "egoldberg@example.com",
    Phone: "(215) 555-0120",
    Notes: "PA resident, NJ employer commute.",
  },
  {
    Client: "Akiko Tanaka",
    Type: "Individual",
    State: "HI",
    "Also Files In": "",
    EIN: "",
    Email: "atanaka@example.com",
    Phone: "(808) 555-0121",
    Notes: "HI resident, mainland real estate income.",
  },

  // ---- S-Corps (~14) with messy Type variants ----
  {
    Client: "Acme Consulting Inc.",
    Type: "S-Corp",
    State: "NY",
    "Also Files In": "NJ",
    EIN: "12-3456789",
    Email: "admin@acmeconsulting.example.com",
    Phone: "(212) 555-0201",
    Notes: "NY PTET elected — 3/15 deadline critical.",
  },
  {
    Client: "Smith Holdings Inc.",
    Type: "S corp",
    State: "NY",
    "Also Files In": "",
    EIN: "23-4567890",
    Email: "jsmith@smithholdings.example.com",
    Phone: "",
    Notes: "John Smith's S-Corp. NY PTET opted in.",
  },
  {
    Client: "Rachel Chen Consulting",
    Type: "S Corporation",
    State: "CA",
    "Also Files In": "",
    EIN: "34-5678901",
    Email: "rachel@chenconsulting.example.com",
    Phone: "(415) 555-0203",
    Notes: "CA PTE prepaid 6/15. Single-member via Rachel Chen.",
  },
  {
    Client: "Bay Area Dental P.C.",
    Type: "1120-S",
    State: "CA",
    "Also Files In": "",
    EIN: "45-6789012",
    Email: "office@bayareadental.example.com",
    Phone: "(650) 555-0204",
    Notes: "Dental practice, 2 dentist shareholders.",
  },
  {
    Client: "Rodriguez & Associates",
    Type: "s-corp",
    State: "TX",
    "Also Files In": "",
    EIN: "56-7890123",
    Email: "info@rodriguezlaw.example.com",
    Phone: "(512) 555-0205",
    Notes: "Law firm, 4 attorney shareholders.",
  },
  {
    Client: "Delaware Services Inc.",
    Type: "SCORP",
    State: "DE",
    "Also Files In": "NJ, NY",
    EIN: "67-8901234",
    Email: "admin@deservices.example.com",
    Phone: "(302) 555-0206",
    Notes: "DE incorporated, operates NE corridor.",
  },
  {
    Client: "TechPro Solutions Inc.",
    Type: "S",
    State: "TX",
    "Also Files In": "CA",
    EIN: "78-9012345",
    Email: "finance@techpro.example.com",
    Phone: "(737) 555-0207",
    Notes: "SaaS company, single founder shareholder.",
  },
  {
    Client: "Lone Star Logistics Inc.",
    Type: "S-Corp",
    State: "TX",
    "Also Files In": "OK, NM",
    EIN: "20-1111111",
    Email: "ar@lonestarlog.example.com",
    Phone: "(512) 555-0208",
    Notes: "Trucking S-Corp, multi-state nexus.",
  },
  {
    Client: "Riverside Auto Group Inc.",
    Type: "1120-S",
    State: "CA",
    "Also Files In": "",
    EIN: "20-2222222",
    Email: "cpa@riversideauto.example.com",
    Phone: "(951) 555-0209",
    Notes: "Two used-car dealerships, IRC §263A inventory.",
  },
  {
    Client: "Mountain View Medical S Corp",
    Type: "S corp",
    State: "CO",
    "Also Files In": "",
    EIN: "20-3333333",
    Email: "office@mvmedical.example.com",
    Phone: "(720) 555-0210",
    Notes: "3-physician practice, profit-sharing 401k.",
  },
  {
    Client: "Northeast Tile & Stone Inc.",
    Type: "S Corporation",
    State: "MA",
    "Also Files In": "RI, CT",
    EIN: "20-4444444",
    Email: "billing@netilest.example.com",
    Phone: "(617) 555-0211",
    Notes: "Construction subcontractor, multi-state worksites.",
  },
  {
    Client: "Crescent City Cafe Inc.",
    Type: "SCORP",
    State: "LA",
    "Also Files In": "",
    EIN: "20-5555555",
    Email: "owner@crescentcity.example.com",
    Phone: "(504) 555-0212",
    Notes: "Single-location restaurant.",
  },
  {
    Client: "Twin Peaks Outdoor Inc.",
    Type: "s-corp",
    State: "CO",
    "Also Files In": "UT, WY",
    EIN: "20-6666666",
    Email: "ops@twinpeaks.example.com",
    Phone: "(303) 555-0213",
    Notes: "Outdoor gear retail, 3 locations.",
  },
  {
    Client: "Sarasota Holdings Inc.",
    Type: "S-Corp",
    State: "FL",
    "Also Files In": "",
    EIN: "20-7777777",
    Email: "ar@sarasota.example.com",
    Phone: "(941) 555-0214",
    Notes: "FL S-Corp, owns 2 commercial properties — Sarasota County.",
  },

  // ---- LLCs (~14) — includes FL cohort for IRS disaster-relief demo ----
  {
    Client: "Johnson Real Estate LLC",
    Type: "LLC",
    State: "CA",
    "Also Files In": "NV, AZ",
    EIN: "89-0123456",
    Email: "mike@johnsonre.example.com",
    Phone: "(310) 555-0301",
    Notes: "Owns 3 rental properties. CA $800 LLC tax.",
  },
  {
    Client: "Martinez Properties LLC",
    Type: "Limited Liability Company",
    State: "TX",
    "Also Files In": "",
    EIN: "90-1234567",
    Email: "sm@martinezprop.example.com",
    Phone: "",
    Notes: "TX franchise tax only, no state income tax.",
  },
  {
    Client: "Peak Ventures LLC",
    Type: "LLC",
    State: "Delaware",
    "Also Files In": "CA, NY",
    EIN: "01-2345678",
    Email: "cfo@peakventures.example.com",
    Phone: "(646) 555-0303",
    Notes: "DE LLC, operations split CA/NY.",
  },
  {
    Client: "Sunrise Holdings LLC",
    Type: "llc",
    State: "NJ",
    "Also Files In": "",
    EIN: "12-3456780",
    Email: "admin@sunriseholdings.example.com",
    Phone: "(201) 555-0304",
    Notes: "NJ BAIT elected for pass-through savings.",
  },
  {
    Client: "Wilson Family LLC",
    Type: "LLC",
    State: "DE",
    "Also Files In": "",
    EIN: "23-4567801",
    Email: "",
    Phone: "(302) 555-0305",
    Notes: "Family wealth vehicle, DE $300 annual tax.",
  },
  // ---- FL LLC cohort (for IRS disaster-relief demo — Hillsborough / Tampa Bay) ----
  {
    Client: "Tampa Bay Holdings LLC",
    Type: "LLC",
    State: "FL",
    "Also Files In": "GA",
    EIN: "30-1010101",
    Email: "admin@tampabayh.example.com",
    Phone: "(813) 555-0306",
    Notes: "Multi-property RE — Hillsborough + Pinellas counties.",
  },
  {
    Client: "Sunshine Coast Rentals LLC",
    Type: "LLC",
    State: "FL",
    "Also Files In": "",
    EIN: "30-1010102",
    Email: "owner@sunshinecoast.example.com",
    Phone: "(727) 555-0307",
    Notes: "Vacation rentals — Tampa Bay area.",
  },
  {
    Client: "Bayshore Properties LLC",
    Type: "Limited Liability Company",
    State: "Florida",
    "Also Files In": "",
    EIN: "30-1010103",
    Email: "info@bayshore.example.com",
    Phone: "(813) 555-0308",
    Notes: "Single-member, Hillsborough County rental portfolio.",
  },
  {
    Client: "Gulf Coast Marina LLC",
    Type: "LLC",
    State: "FL",
    "Also Files In": "AL",
    EIN: "30-1010104",
    Email: "manager@gulfcoastm.example.com",
    Phone: "(941) 555-0309",
    Notes: "Boat slip rentals — exposure to FL hurricane disaster relief.",
  },
  {
    Client: "Hillsborough Title LLC",
    Type: "llc",
    State: "FL",
    "Also Files In": "",
    EIN: "30-1010105",
    Email: "ops@hillsboroughtitle.example.com",
    Phone: "(813) 555-0310",
    Notes: "Title services — Hillsborough County focus.",
  },
  // ---- Other LLCs ----
  {
    Client: "Cascade Tech LLC",
    Type: "LLC",
    State: "WA",
    "Also Files In": "OR, CA",
    EIN: "30-2222222",
    Email: "admin@cascadetech.example.com",
    Phone: "(206) 555-0311",
    Notes: "WA tech consulting, multi-state remote team.",
  },
  {
    Client: "Empire State Realty LLC",
    Type: "Limited Liability Company",
    State: "NY",
    "Also Files In": "",
    EIN: "30-3333333",
    Email: "office@empireny.example.com",
    Phone: "(212) 555-0312",
    Notes: "NYC commercial RE holdings.",
  },
  {
    Client: "Bluebonnet Farms LLC",
    Type: "llc",
    State: "TX",
    "Also Files In": "",
    EIN: "30-4444444",
    Email: "farm@bluebonnet.example.com",
    Phone: "(512) 555-0313",
    Notes: "TX agriculture LLC, ag exemption.",
  },
  {
    Client: "Liberty Investments LLC",
    Type: "LLC",
    State: "DE",
    "Also Files In": "VA, MD",
    EIN: "30-5555555",
    Email: "cfo@libertyinv.example.com",
    Phone: "(302) 555-0314",
    Notes: "Investment vehicle, DE Series LLC structure.",
  },

  // ---- Partnerships (~7) ----
  {
    Client: "Brown & Green Partners",
    Type: "Partnership",
    State: "NY",
    "Also Files In": "",
    EIN: "34-5678012",
    Email: "admin@brownandgreen.example.com",
    Phone: "(212) 555-0401",
    Notes: "Law firm, 12 partners, NY PTET elected.",
  },
  {
    Client: "Austin Investment Group LP",
    Type: "LP",
    State: "TX",
    "Also Files In": "CA",
    EIN: "45-6780123",
    Email: "partners@austininv.example.com",
    Phone: "(737) 555-0402",
    Notes: "Limited partnership, 8 LPs + 1 GP.",
  },
  {
    Client: "Medical Associates of NY",
    Type: "1065",
    State: "NY",
    "Also Files In": "",
    EIN: "56-7801234",
    Email: "billing@medassocny.example.com",
    Phone: "(718) 555-0403",
    Notes: "Physician partnership, 5 doctors.",
  },
  {
    Client: "Cascade Engineering LLP",
    Type: "LLP",
    State: "WA",
    "Also Files In": "OR",
    EIN: "40-1111111",
    Email: "admin@cascadeeng.example.com",
    Phone: "(206) 555-0404",
    Notes: "Civil engineering, 6 partners.",
  },
  {
    Client: "Buckeye Realty Partners",
    Type: "Partnership",
    State: "OH",
    "Also Files In": "MI, IN",
    EIN: "40-2222222",
    Email: "ops@buckeyere.example.com",
    Phone: "(614) 555-0405",
    Notes: "Multi-state CRE syndicate, K-1 to 23 partners.",
  },
  {
    Client: "Golden Gate Capital LP",
    Type: "LP",
    State: "CA",
    "Also Files In": "",
    EIN: "40-3333333",
    Email: "investor@goldengate.example.com",
    Phone: "(415) 555-0406",
    Notes: "VC fund, 12 LPs.",
  },
  {
    Client: "Heartland Ag Partners",
    Type: "Partnership",
    State: "IA",
    "Also Files In": "MN",
    EIN: "40-4444444",
    Email: "ops@heartlandag.example.com",
    Phone: "(515) 555-0407",
    Notes: "Family farming partnership, Section 179 heavy.",
  },

  // ---- C-Corps (~5) ----
  {
    Client: "Global Enterprises Inc.",
    Type: "C-Corp",
    State: "DE",
    "Also Files In": "NY, CA, TX",
    EIN: "67-8012345",
    Email: "cfo@globalent.example.com",
    Phone: "(212) 555-0501",
    Notes: "Holding company, multi-state nexus.",
  },
  {
    Client: "Pacific Trading Corp",
    Type: "C corporation",
    State: "CA",
    "Also Files In": "OR, WA",
    EIN: "78-0123456",
    Email: "controller@pactrading.example.com",
    Phone: "(415) 555-0502",
    Notes: "Import/export, annual audit required.",
  },
  {
    Client: "Skylight Software Corp",
    Type: "C-Corp",
    State: "DE",
    "Also Files In": "CA, TX",
    EIN: "50-1111111",
    Email: "cfo@skylightsw.example.com",
    Phone: "(415) 555-0503",
    Notes: "DE C-Corp Series A, R&D credit candidate.",
  },
  {
    Client: "Steel Works Manufacturing Inc.",
    Type: "C corporation",
    State: "PA",
    "Also Files In": "OH, WV",
    EIN: "50-2222222",
    Email: "controller@steelworks.example.com",
    Phone: "(412) 555-0504",
    Notes: "Manufacturing C-Corp, IRC §199A N/A.",
  },
  {
    Client: "Coastal Biotech Inc.",
    Type: "Corporation",
    State: "MA",
    "Also Files In": "",
    EIN: "50-3333333",
    Email: "finance@coastalbio.example.com",
    Phone: "(617) 555-0505",
    Notes: "Pre-revenue biotech, NOL carryforward heavy.",
  },

  // ---- Trusts / Estates (~4) ----
  {
    Client: "Smith Family Trust",
    Type: "Trust",
    State: "NY",
    "Also Files In": "",
    EIN: "89-0123457",
    Email: "jsmith@example.com",
    Phone: "",
    Notes: "Revocable trust, grantor treatment.",
  },
  {
    Client: "Chen Revocable Trust",
    Type: "1041",
    State: "CA",
    "Also Files In": "",
    EIN: "90-1234568",
    Email: "rachel.chen@example.com",
    Phone: "",
    Notes: "Estate planning vehicle for Chen family.",
  },
  {
    Client: "Wilson Charitable Remainder Trust",
    Type: "Trust",
    State: "DE",
    "Also Files In": "",
    EIN: "60-1111111",
    Email: "trustee@wilsoncrt.example.com",
    Phone: "",
    Notes: "CRT — annuity payout to grantor.",
  },
  {
    Client: "Estate of Margaret Foster",
    Type: "Estate",
    State: "FL",
    "Also Files In": "GA",
    EIN: "60-2222222",
    Email: "executor@fosterestate.example.com",
    Phone: "(305) 555-0610",
    Notes: "Decedent's estate, 706 + 1041 in process.",
  },

  // ---- Nonprofit (~2) ----
  {
    Client: "Green Valley Foundation",
    Type: "501(c)(3)",
    State: "CA",
    "Also Files In": "",
    EIN: "01-2345670",
    Email: "director@greenvalley.example.org",
    Phone: "(650) 555-0601",
    Notes: "Environmental nonprofit, 990 filer.",
  },
  {
    Client: "Riverside Community Health",
    Type: "Nonprofit",
    State: "OR",
    "Also Files In": "",
    EIN: "70-1111111",
    Email: "cfo@riversidehealth.example.com",
    Phone: "(503) 555-0602",
    Notes: "FQHC, Form 990 + state CT-12 in OR.",
  },

  // ---- Edge cases (intentional) ----
  {
    // Missing client name — should be skipped during apply
    Client: "",
    Type: "Individual",
    State: "NY",
    "Also Files In": "",
    EIN: "",
    Email: "orphan@example.com",
    Phone: "",
    Notes: "Incomplete row — test skip behavior.",
  },
  {
    // Unknown entity type — should default to Individual with warning
    Client: "Ambiguous Client",
    Type: "Weird Thing",
    State: "CA",
    "Also Files In": "",
    EIN: "",
    Email: "ambig@example.com",
    Phone: "",
    Notes: "Entity type test — should trigger warning.",
  },
  {
    // Invalid email — should be cleared with warning
    Client: "Victor Kovalenko",
    Type: "Individual",
    State: "California",
    "Also Files In": "",
    EIN: "",
    Email: "not-a-valid-email",
    Phone: "",
    Notes: "Email test — should trigger warning.",
  },
];

function main() {
  const outDir = "/Users/yxiao/Desktop/yi/work/DueDateHQ";

  // ---- XLSX ----
  const ws = XLSX.utils.json_to_sheet(ROWS);
  ws["!cols"] = [
    { wch: 30 }, // Client
    { wch: 18 }, // Type
    { wch: 14 }, // State
    { wch: 18 }, // Also Files In
    { wch: 14 }, // EIN
    { wch: 32 }, // Email
    { wch: 16 }, // Phone
    { wch: 45 }, // Notes
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clients 2025");
  const xlsxPath = path.join(outDir, "mock-clients.xlsx");
  XLSX.writeFile(wb, xlsxPath);

  // ---- CSV (for testing paste flow too) ----
  const csvPath = path.join(outDir, "mock-clients.csv");
  const csv = XLSX.utils.sheet_to_csv(ws);
  fs.writeFileSync(csvPath, csv, "utf8");

  console.log(`✅ Wrote ${ROWS.length} rows:`);
  console.log(`   ${xlsxPath}`);
  console.log(`   ${csvPath}`);
  console.log(``);
  console.log(`Breakdown:`);
  const byType = ROWS.reduce<Record<string, number>>((acc, r) => {
    acc[r.Type] = (acc[r.Type] ?? 0) + 1;
    return acc;
  }, {});
  for (const [k, v] of Object.entries(byType)) {
    console.log(`   ${k}: ${v}`);
  }
}

main();
