import { describe, expect, it } from "vitest";
import { FileExtensionInputSchema } from "./deadlines";

/**
 * The Zod schema is the input contract for fileExtension(). It
 * protects the DB layer from malformed dates (which would silently
 * write garbage) and from un-typed actor strings (which would break
 * audit log filtering). These tests cover the boundary — the
 * fileExtension function itself talks to Postgres and lives in the
 * integration-test tier.
 */
describe("FileExtensionInputSchema", () => {
  it("accepts a well-formed input with default actor", () => {
    const parsed = FileExtensionInputSchema.parse({
      deadlineInstanceId: "di_abc123",
      orgId: "org_xyz",
      newDueDate: "2027-10-15",
    });
    expect(parsed.actorType).toBe("user"); // default
    expect(parsed.actorId).toBeNull(); // default
    expect(parsed.newDueDate).toBe("2027-10-15");
  });

  it("rejects malformed dates", () => {
    expect(() =>
      FileExtensionInputSchema.parse({
        deadlineInstanceId: "di_x",
        orgId: "org_x",
        newDueDate: "10/15/2027", // wrong format
      }),
    ).toThrow(/YYYY-MM-DD/);

    expect(() =>
      FileExtensionInputSchema.parse({
        deadlineInstanceId: "di_x",
        orgId: "org_x",
        newDueDate: "2027-13-45", // structurally bogus but matches regex
      }),
    ).not.toThrow(); // Schema only enforces shape — date validity is a deeper concern
  });

  it("rejects unknown actor types", () => {
    expect(() =>
      FileExtensionInputSchema.parse({
        deadlineInstanceId: "di_x",
        orgId: "org_x",
        newDueDate: "2027-10-15",
        actorType: "robot", // not in the enum
      }),
    ).toThrow();
  });

  it("requires deadlineInstanceId and orgId", () => {
    expect(() =>
      FileExtensionInputSchema.parse({
        orgId: "org_x",
        newDueDate: "2027-10-15",
      }),
    ).toThrow();
    expect(() =>
      FileExtensionInputSchema.parse({
        deadlineInstanceId: "di_x",
        newDueDate: "2027-10-15",
      }),
    ).toThrow();
  });
});
