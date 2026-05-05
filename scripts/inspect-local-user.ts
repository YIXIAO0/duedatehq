import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const sql = neon(url);

async function main() {
  const u = await sql`SELECT id, email, full_name, created_at FROM users WHERE email = 'yxiao@dify.ai'`;
  console.log("User row(s) for yxiao@dify.ai:");
  console.log(u);
  if (u.length === 0) return;

  for (const user of u) {
    const ms = await sql`SELECT m.org_id, m.role, o.name FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = ${user.id}`;
    console.log(`\nMemberships for ${user.email}:`);
    console.log(ms);
    for (const m of ms) {
      const c = await sql`SELECT COUNT(*)::int AS c FROM clients WHERE org_id = ${m.org_id}`;
      const e = await sql`SELECT COUNT(*)::int AS c FROM entities WHERE org_id = ${m.org_id}`;
      const d = await sql`SELECT COUNT(*)::int AS c FROM deadline_instances WHERE org_id = ${m.org_id}`;
      const s = await sql`SELECT COUNT(*)::int AS c FROM deadline_subtasks WHERE org_id = ${m.org_id}`;
      const ae = await sql`SELECT COUNT(*)::int AS c FROM audit_events WHERE org_id = ${m.org_id}`;
      const inv = await sql`SELECT COUNT(*)::int AS c FROM invitations WHERE org_id = ${m.org_id}`;
      const noti = await sql`SELECT COUNT(*)::int AS c FROM notifications WHERE org_id = ${m.org_id}`;
      console.log(`  org ${m.org_id} (${m.name}, ${m.role}):`);
      console.log(`    clients: ${c[0].c}, entities: ${e[0].c}, deadlines: ${d[0].c}, subtasks: ${s[0].c}, audit: ${ae[0].c}, invites: ${inv[0].c}, notifications: ${noti[0].c}`);
      const otherMembers = await sql`SELECT u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ${m.org_id} AND m.user_id != ${user.id}`;
      console.log(`    other members in this org: ${otherMembers.length === 0 ? "(none)" : otherMembers.map(x => `${x.email} (${x.role})`).join(", ")}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
