"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentContext } from "@/lib/auth/current-org";
import { markCompleted } from "@/lib/services/deadlines";

const BulkMarkCompleteSchema = z.object({
  deadlineIds: z.array(z.string().min(1)).min(1).max(200),
});

export async function bulkMarkCompleteAction(
  input: z.input<typeof BulkMarkCompleteSchema>,
) {
  const ctx = await getCurrentContext();
  const parsed = BulkMarkCompleteSchema.parse(input);

  let succeeded = 0;
  const failed: string[] = [];
  for (const id of parsed.deadlineIds) {
    try {
      await markCompleted({
        deadlineInstanceId: id,
        orgId: ctx.organization.id,
        actorType: "user",
        actorId: ctx.user.id,
      });
      succeeded += 1;
    } catch (err) {
      failed.push(id);
    }
  }

  revalidatePath("/dashboard");
  return { succeeded, failed: failed.length };
}
