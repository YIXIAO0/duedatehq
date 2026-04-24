import { NextResponse } from "next/server";
import { getCurrentContext } from "@/lib/auth/current-org";
import { globalSearch } from "@/lib/services/search";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const query = (url.searchParams.get("q") || "").trim();
  if (!query) return NextResponse.json({ results: [] });

  const ctx = await getCurrentContext();
  try {
    const results = await globalSearch({
      orgId: ctx.organization.id,
      query,
      limit: 20,
    });
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[search] error:", err);
    return NextResponse.json({ results: [], error: "Search failed" });
  }
}
