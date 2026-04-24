/**
 * Global search across clients, entities, and upcoming deadlines.
 *
 * Strategy: simple ILIKE with a leading-match preference. Good enough up
 * to ~500 clients. When we grow past that, swap in pg_trgm / full-text
 * without changing the API.
 */

import "server-only";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

export const SearchInputSchema = z.object({
  orgId: z.string(),
  query: z.string().min(1).max(100),
  limit: z.number().int().positive().max(50).default(20),
});
export type SearchInput = z.input<typeof SearchInputSchema>;

export type SearchHit =
  | {
      type: "client";
      id: string;
      title: string;
      subtitle: string | null;
      href: string;
    }
  | {
      type: "entity";
      id: string;
      title: string;
      subtitle: string;
      href: string;
    }
  | {
      type: "deadline";
      id: string;
      title: string;
      subtitle: string;
      href: string;
      dueDate: string;
    };

export async function globalSearch(input: SearchInput): Promise<SearchHit[]> {
  const parsed = SearchInputSchema.parse(input);
  const db = getDb();

  const like = `%${parsed.query}%`;
  const startLike = `${parsed.query}%`;

  const results: SearchHit[] = [];

  // --- Clients ---
  const clientRows = await db.execute<{
    id: string;
    name: string;
    primary_contact_email: string | null;
    starts_with: boolean;
  }>(sql`
    SELECT id, name, primary_contact_email,
      (LOWER(name) LIKE LOWER(${startLike})) AS starts_with
    FROM clients
    WHERE org_id = ${parsed.orgId}
      AND archived_at IS NULL
      AND (LOWER(name) LIKE LOWER(${like})
           OR LOWER(COALESCE(primary_contact_email, '')) LIKE LOWER(${like}))
    ORDER BY starts_with DESC, name ASC
    LIMIT ${parsed.limit}
  `);

  for (const row of clientRows.rows) {
    results.push({
      type: "client",
      id: row.id,
      title: row.name,
      subtitle: row.primary_contact_email,
      href: `/clients/${row.id}`,
    });
  }

  // --- Entities ---
  const entityRows = await db.execute<{
    id: string;
    name: string;
    entity_type: string;
    home_state: string | null;
    client_id: string;
    client_name: string;
  }>(sql`
    SELECT e.id, e.name, e.entity_type, e.home_state,
           c.id AS client_id, c.name AS client_name
    FROM entities e
    INNER JOIN clients c ON c.id = e.client_id
    WHERE e.org_id = ${parsed.orgId}
      AND e.archived_at IS NULL
      AND LOWER(e.name) LIKE LOWER(${like})
    ORDER BY e.name ASC
    LIMIT ${parsed.limit}
  `);

  for (const row of entityRows.rows) {
    results.push({
      type: "entity",
      id: row.id,
      title: row.name,
      subtitle: `${row.client_name} · ${row.entity_type}${
        row.home_state ? ` · ${row.home_state}` : ""
      }`,
      href: `/clients/${row.client_id}`,
    });
  }

  // --- Deadlines (upcoming only) ---
  const deadlineRows = await db.execute<{
    id: string;
    due_date: string;
    effective_due_date: string;
    rule_title: string;
    form_code: string;
    entity_name: string;
    client_name: string;
  }>(sql`
    SELECT di.id,
           di.due_date,
           COALESCE(di.extension_due_date, di.due_date) AS effective_due_date,
           r.title AS rule_title,
           r.form_code,
           e.name AS entity_name,
           c.name AS client_name
    FROM deadline_instances di
    INNER JOIN deadline_rules r ON r.id = di.rule_id
    INNER JOIN entities e ON e.id = di.entity_id
    INNER JOIN clients c ON c.id = e.client_id
    WHERE di.org_id = ${parsed.orgId}
      AND di.status IN ('pending', 'in_progress', 'extended')
      AND (
        LOWER(r.title) LIKE LOWER(${like})
        OR LOWER(r.form_code) LIKE LOWER(${like})
        OR LOWER(e.name) LIKE LOWER(${like})
        OR LOWER(c.name) LIKE LOWER(${like})
      )
    ORDER BY effective_due_date ASC
    LIMIT ${parsed.limit}
  `);

  for (const row of deadlineRows.rows) {
    const showEntityInSubtitle =
      row.entity_name && row.entity_name !== row.client_name;
    results.push({
      type: "deadline",
      id: row.id,
      title: `${row.form_code} — ${row.client_name}`,
      subtitle: showEntityInSubtitle
        ? `${row.entity_name} · ${row.rule_title}`
        : row.rule_title,
      href: `/deadlines/${row.id}`,
      dueDate: row.effective_due_date,
    });
  }

  return results;
}
