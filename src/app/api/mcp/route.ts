/**
 * MCP HTTP endpoint — JSON-RPC-style transport for agent tool calls.
 *
 * Day 1 stub: minimal JSON-RPC 2.0 endpoint supporting `initialize`,
 * `tools/list`, and `tools/call`. This is NOT a full MCP spec impl — it's
 * enough for a Claude/OpenAI/custom agent to discover tools and invoke them.
 *
 * V2 upgrades:
 *   - Full MCP Streamable HTTP transport (@modelcontextprotocol/sdk Server)
 *   - OAuth / API key auth on each request
 *   - Session management + SSE streaming for long-running tool calls
 */

import { NextResponse } from "next/server";
import { mcpTools } from "@/lib/mcp/server";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
};

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status: 200 },
  );
}

export async function POST(req: Request) {
  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  if (body.jsonrpc !== "2.0" || !body.method) {
    return rpcError(body.id ?? null, -32600, "Invalid Request");
  }

  switch (body.method) {
    case "initialize": {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-03-26",
          serverInfo: { name: "duedatehq", version: "0.1.0" },
          capabilities: { tools: {} },
        },
      });
    }

    case "tools/list": {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: mcpTools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: { type: "object" }, // V2: emit proper JSON schema from Zod
          })),
        },
      });
    }

    case "tools/call": {
      const params = body.params as { name?: string; arguments?: unknown };
      const tool = mcpTools.find((t) => t.name === params?.name);
      if (!tool) {
        return rpcError(body.id, -32602, `Unknown tool: ${params?.name}`);
      }
      try {
        const parsed = tool.inputSchema.parse(params.arguments ?? {});
        const result = await tool.handler(parsed);
        return NextResponse.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return rpcError(body.id, -32000, message);
      }
    }

    default:
      return rpcError(body.id, -32601, `Method not found: ${body.method}`);
  }
}

export async function GET() {
  return NextResponse.json({
    name: "DueDateHQ MCP",
    version: "0.1.0",
    transport: "http-json-rpc",
    status: "stub",
    toolCount: mcpTools.length,
  });
}
