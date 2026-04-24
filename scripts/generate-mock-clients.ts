/**
 * Generate a realistic mock client list for testing the import flow.
 *
 * Scenario: Sarah Chen (solo CPA in Austin) exporting her Excel tracker.
 * ~30 rows with deliberate messiness to stress-test AI column mapping:
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

  // ---- S-Corps (~7) with messy Type variants ----
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

  // ---- LLCs (~5) ----
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

  // ---- Partnerships (~3) ----
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

  // ---- C-Corps (~2) ----
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

  // ---- Trusts (~2) ----
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

  // ---- Nonprofit ----
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
