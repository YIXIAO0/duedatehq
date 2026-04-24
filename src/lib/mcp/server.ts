/**
 * MCP server definition — exposes DueDateHQ operations as tools for agents.
 *
 * Day 1 stub: 3 tools (list_deadlines, create_client, mark_deadline_complete).
 * The tool handlers are thin wrappers over the service layer — agents and UI
 * both exercise the same business logic.
 *
 * V2 will add: OAuth / API-key auth, more tools (notices, extensions),
 * structured error responses per MCP spec.
 */

import { z } from "zod";
import {
  CreateClientInputSchema,
  createClient,
  listClients,
} from "@/lib/services/clients";
import {
  ListUpcomingInputSchema,
  MarkCompletedInputSchema,
  listUpcoming,
  markCompleted,
} from "@/lib/services/deadlines";

// Tool descriptors — shape will be consumed by the HTTP route handler.
export const mcpTools = [
  {
    name: "list_deadlines",
    description:
      "List upcoming tax deadlines for an organization within a date window.",
    inputSchema: ListUpcomingInputSchema,
    handler: async (input: unknown) => listUpcoming(input as z.infer<typeof ListUpcomingInputSchema>),
  },
  {
    name: "list_clients",
    description: "List all non-archived clients for an organization.",
    inputSchema: z.object({
      orgId: z.string(),
      limit: z.number().int().positive().max(500).default(100),
      offset: z.number().int().nonnegative().default(0),
    }),
    handler: async (input: unknown) => {
      const parsed = input as { orgId: string; limit?: number; offset?: number };
      return listClients({
        orgId: parsed.orgId,
        includeArchived: false,
        limit: parsed.limit ?? 100,
        offset: parsed.offset ?? 0,
      });
    },
  },
  {
    name: "create_client",
    description: "Create a new client record in an organization.",
    inputSchema: CreateClientInputSchema,
    handler: async (input: unknown) =>
      createClient({
        ...(input as z.infer<typeof CreateClientInputSchema>),
        actorType: "agent",
      }),
  },
  {
    name: "mark_deadline_complete",
    description:
      "Mark a deadline instance as completed. Used by agents after verifying filing evidence.",
    inputSchema: MarkCompletedInputSchema,
    handler: async (input: unknown) =>
      markCompleted({
        ...(input as z.infer<typeof MarkCompletedInputSchema>),
        actorType: "agent",
      }),
  },
] as const;

export type McpToolName = (typeof mcpTools)[number]["name"];
