/**
 * Serve an XLSX template with example rows so users who don't have an
 * existing spreadsheet can download → fill in → upload.
 */

import * as XLSX from "xlsx";

const SAMPLE_ROWS = [
  {
    "Client Name": "John & Jane Smith",
    "Entity Name": "John Smith",
    "Entity Type": "Individual",
    "Home State": "CA",
    "Operating States": "CA, NY",
    EIN: "",
    "Contact Email": "smith@example.com",
    "Contact Phone": "(555) 123-4567",
    Notes: "Prior client, filed jointly last year",
  },
  {
    "Client Name": "Acme Holdings",
    "Entity Name": "Acme Holdings LLC",
    "Entity Type": "LLC",
    "Home State": "DE",
    "Operating States": "CA, TX",
    EIN: "12-3456789",
    "Contact Email": "cfo@acme.example.com",
    "Contact Phone": "",
    Notes: "Delaware LLC, multi-state nexus",
  },
  {
    "Client Name": "Chen Family",
    "Entity Name": "Chen Holdings Inc.",
    "Entity Type": "S-Corp",
    "Home State": "NY",
    "Operating States": "",
    EIN: "98-7654321",
    "Contact Email": "",
    "Contact Phone": "",
    Notes: "S-Corp election for 2024 tax year — NY PTET opted in",
  },
];

export async function GET() {
  const ws = XLSX.utils.json_to_sheet(SAMPLE_ROWS);
  // Set column widths so it looks tidy on open
  ws["!cols"] = [
    { wch: 22 }, // Client Name
    { wch: 22 }, // Entity Name
    { wch: 14 }, // Entity Type
    { wch: 12 }, // Home State
    { wch: 20 }, // Operating States
    { wch: 14 }, // EIN
    { wch: 24 }, // Contact Email
    { wch: 16 }, // Contact Phone
    { wch: 40 }, // Notes
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clients");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="duedatehq-template.xlsx"',
    },
  });
}
