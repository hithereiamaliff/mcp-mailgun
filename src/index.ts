#!/usr/bin/env node

/**
 * Mailgun MCP Server - STDIO Entry Point
 * For local MCP clients (Claude Desktop, Cursor, etc.)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMailgunMcpServer } from "./mailgun-mcp.js";

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_API_REGION = (
  process.env.MAILGUN_API_REGION || "us"
).toLowerCase();

/**
 * Main function to initialize and start the MCP server
 */
async function main(): Promise<void> {
  try {
    if (!MAILGUN_API_KEY) {
      console.error(
        "Error: MAILGUN_API_KEY environment variable is required. Set it in your MCP client configuration."
      );
      process.exit(1);
    }

    const server = createMailgunMcpServer(MAILGUN_API_KEY, MAILGUN_API_REGION);

    // Connect to the transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Mailgun MCP Server running on stdio");
  } catch (error) {
    console.error("Fatal error in main():", error);
    process.exit(1);
  }
}

main();
