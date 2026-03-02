#!/usr/bin/env node

/**
 * Mailgun MCP Server - HTTP Server Entry Point
 * For self-hosting on VPS with nginx reverse proxy
 * Uses Streamable HTTP transport
 */

import express, { Request, Response } from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMailgunMcpServer } from "./mailgun-mcp.js";
import { FirebaseAnalytics, Analytics } from "./firebase-analytics.js";

// Configuration
const PORT = parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const ANALYTICS_DATA_DIR = process.env.ANALYTICS_DIR || "/app/data";
const ANALYTICS_FILE = path.join(ANALYTICS_DATA_DIR, "analytics.json");
const SAVE_INTERVAL_MS = 60000; // Save every 60 seconds
const MAX_RECENT_CALLS = 100;

// Default Mailgun config (can be overridden per-request via query params)
const DEFAULT_API_KEY = process.env.MAILGUN_API_KEY || "";
const DEFAULT_REGION = (
  process.env.MAILGUN_API_REGION || "us"
).toLowerCase();
const ANALYTICS_RESET_KEY = process.env.ANALYTICS_RESET_KEY || "";
const ANALYTICS_IMPORT_KEY = process.env.ANALYTICS_IMPORT_KEY || "";

// Initialize analytics
let analytics: Analytics = {
  serverStartTime: new Date().toISOString(),
  totalRequests: 0,
  totalToolCalls: 0,
  requestsByMethod: {},
  requestsByEndpoint: {},
  toolCalls: {},
  recentToolCalls: [],
  clientsByIp: {},
  clientsByUserAgent: {},
  hourlyRequests: {},
};

// Ensure data directory exists
function ensureDataDir(): void {
  if (!fs.existsSync(ANALYTICS_DATA_DIR)) {
    fs.mkdirSync(ANALYTICS_DATA_DIR, { recursive: true });
    console.log(`📁 Created analytics data directory: ${ANALYTICS_DATA_DIR}`);
  }
}

// Load analytics from disk on startup
function loadAnalytics(): void {
  try {
    ensureDataDir();
    if (fs.existsSync(ANALYTICS_FILE)) {
      const data = fs.readFileSync(ANALYTICS_FILE, "utf-8");
      const loaded = JSON.parse(data) as Analytics;
      analytics = {
        ...loaded,
        serverStartTime: loaded.serverStartTime || new Date().toISOString(),
      };
      console.log(`📊 Loaded analytics from ${ANALYTICS_FILE}`);
      console.log(`   Total requests: ${analytics.totalRequests}`);
    } else {
      console.log(`📊 No existing analytics file, starting fresh`);
    }
  } catch (error) {
    console.error(`⚠️ Failed to load analytics:`, error);
  }
}

// Save analytics to disk
function saveAnalytics(): void {
  try {
    ensureDataDir();
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2));
    console.log(`💾 Saved analytics to ${ANALYTICS_FILE}`);
  } catch (error) {
    console.error(`⚠️ Failed to save analytics:`, error);
  }
}

// Track HTTP request
function trackRequest(req: Request, endpoint: string): void {
  analytics.totalRequests++;

  const method = req.method;
  analytics.requestsByMethod[method] =
    (analytics.requestsByMethod[method] || 0) + 1;

  analytics.requestsByEndpoint[endpoint] =
    (analytics.requestsByEndpoint[endpoint] || 0) + 1;

  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.ip ||
    "unknown";
  analytics.clientsByIp[clientIp] =
    (analytics.clientsByIp[clientIp] || 0) + 1;

  const userAgent = req.headers["user-agent"] || "unknown";
  const shortAgent = userAgent.substring(0, 50);
  analytics.clientsByUserAgent[shortAgent] =
    (analytics.clientsByUserAgent[shortAgent] || 0) + 1;

  const hour = new Date().toISOString().substring(0, 13);
  analytics.hourlyRequests[hour] =
    (analytics.hourlyRequests[hour] || 0) + 1;
}

// Track tool call
function trackToolCall(toolName: string, req: Request): void {
  analytics.totalToolCalls++;
  analytics.toolCalls[toolName] =
    (analytics.toolCalls[toolName] || 0) + 1;

  const toolCall = {
    tool: toolName,
    timestamp: new Date().toISOString(),
    clientIp:
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      "unknown",
    userAgent: (req.headers["user-agent"] || "unknown").substring(0, 50),
  };

  analytics.recentToolCalls.unshift(toolCall);
  if (analytics.recentToolCalls.length > MAX_RECENT_CALLS) {
    analytics.recentToolCalls.pop();
  }
}

// Calculate uptime
function getUptime(): string {
  const start = new Date(analytics.serverStartTime).getTime();
  const now = Date.now();
  const diff = now - start;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Initialize Firebase Analytics
const firebaseAnalytics = new FirebaseAnalytics("mcp-mailgun");

// Load analytics on startup (try Firebase first, then local)
async function initializeAnalytics() {
  if (firebaseAnalytics.isInitialized()) {
    const firebaseData = await firebaseAnalytics.loadAnalytics();
    if (firebaseData) {
      analytics = firebaseData;
      console.log("📊 Loaded analytics from Firebase");
      return;
    }
  }

  // Fallback to local file
  loadAnalytics();
}

initializeAnalytics();

// Periodic save (to both Firebase and local)
const saveInterval = setInterval(async () => {
  saveAnalytics(); // Local backup
  if (firebaseAnalytics.isInitialized()) {
    await firebaseAnalytics.saveAnalytics(analytics); // Firebase primary
  }
}, SAVE_INTERVAL_MS);

// Create Express app
const app = express();
app.use(express.json());

// Enhanced CORS configuration for MCP clients
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-Mailgun-Api-Key",
      "X-Mailgun-Region",
      "Accept",
      "Accept-Encoding",
      "Cache-Control",
      "Connection",
      "User-Agent",
      "X-Requested-With",
    ],
    exposedHeaders: ["Content-Type", "Cache-Control"],
    credentials: false,
    maxAge: 86400,
  })
);

// Handle OPTIONS preflight requests explicitly
app.options("*", cors());

// Root endpoint - server info
app.get("/", (req: Request, res: Response) => {
  trackRequest(req, "/");
  res.json({
    name: "Mailgun MCP Server",
    version: "1.0.0",
    description:
      "MCP server for Mailgun email service - manage messages, domains, templates, and more",
    transport: "streamable-http",
    endpoints: {
      health: "/health",
      mcp: "/mcp",
      analytics: "/analytics",
      dashboard: "/analytics/dashboard",
      tools: "/analytics/tools",
    },
  });
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  trackRequest(req, "/health");
  res.json({
    status: "healthy",
    server: "Mailgun MCP Server",
    version: "1.0.0",
    transport: "streamable-http",
    uptime: getUptime(),
    firebase: firebaseAnalytics.isInitialized() ? "connected" : "not configured",
    timestamp: new Date().toISOString(),
  });
});

// Analytics JSON endpoint
app.get("/analytics", (req: Request, res: Response) => {
  trackRequest(req, "/analytics");
  res.json({
    ...analytics,
    uptime: getUptime(),
    firebase: firebaseAnalytics.isInitialized() ? "connected" : "not configured",
  });
});

// Analytics tools endpoint
app.get("/analytics/tools", (req: Request, res: Response) => {
  trackRequest(req, "/analytics/tools");

  const toolStats = Object.entries(analytics.toolCalls)
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => (b.count as number) - (a.count as number));

  res.json({
    totalToolCalls: analytics.totalToolCalls,
    uniqueTools: toolStats.length,
    tools: toolStats,
    recentCalls: analytics.recentToolCalls.slice(0, 20),
  });
});

// Analytics reset endpoint
app.post("/analytics/reset", (req: Request, res: Response) => {
  trackRequest(req, "/analytics/reset");

  if (!ANALYTICS_RESET_KEY) {
    res.status(403).json({ error: "Analytics reset is not configured" });
    return;
  }

  const providedKey =
    (req.query.key as string) ||
    (req.headers["x-analytics-reset-key"] as string);

  if (providedKey !== ANALYTICS_RESET_KEY) {
    res.status(403).json({ error: "Invalid reset key" });
    return;
  }

  analytics = {
    serverStartTime: new Date().toISOString(),
    totalRequests: 0,
    totalToolCalls: 0,
    requestsByMethod: {},
    requestsByEndpoint: {},
    toolCalls: {},
    recentToolCalls: [],
    clientsByIp: {},
    clientsByUserAgent: {},
    hourlyRequests: {},
  };
  saveAnalytics();
  res.json({ message: "Analytics reset successfully" });
});

// Analytics import endpoint
app.post("/analytics/import", (req: Request, res: Response) => {
  trackRequest(req, "/analytics/import");

  if (!ANALYTICS_IMPORT_KEY) {
    res.status(403).json({ error: "Analytics import is not configured" });
    return;
  }

  const providedKey =
    (req.query.key as string) ||
    (req.headers["x-analytics-import-key"] as string);

  if (providedKey !== ANALYTICS_IMPORT_KEY) {
    res.status(403).json({ error: "Invalid import key" });
    return;
  }

  try {
    const importData = req.body;
    if (importData.totalRequests) {
      analytics.totalRequests += importData.totalRequests;
    }
    if (importData.totalToolCalls) {
      analytics.totalToolCalls += importData.totalToolCalls;
    }
    saveAnalytics();
    res.json({
      message: "Analytics imported successfully",
      currentStats: {
        totalRequests: analytics.totalRequests,
        totalToolCalls: analytics.totalToolCalls,
      },
    });
  } catch (error) {
    res
      .status(400)
      .json({ error: "Failed to import analytics", details: String(error) });
  }
});

// Analytics dashboard endpoint
app.get("/analytics/dashboard", (req: Request, res: Response) => {
  trackRequest(req, "/analytics/dashboard");

  const topTools = Object.entries(analytics.toolCalls)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 10);

  const topEndpoints = Object.entries(analytics.requestsByEndpoint)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 10);

  const sortedHours = Object.entries(analytics.hourlyRequests)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-24);

  const topAgents = Object.entries(analytics.clientsByUserAgent)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 10);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mailgun MCP Analytics</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    .header h1 { font-size: 2em; color: #f97316; margin-bottom: 5px; }
    .header p { color: #94a3b8; font-size: 0.9em; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
    .stat-card { background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border: 1px solid #334155; }
    .stat-card .value { font-size: 2em; font-weight: bold; color: #f97316; }
    .stat-card .label { color: #94a3b8; font-size: 0.85em; margin-top: 5px; }
    .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .chart-card { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }
    .chart-card h3 { color: #f8fafc; margin-bottom: 15px; font-size: 1.1em; }
    .recent-calls { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }
    .recent-calls h3 { color: #f8fafc; margin-bottom: 15px; }
    .call-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #334155; font-size: 0.85em; }
    .call-item:last-child { border-bottom: none; }
    .call-tool { color: #f97316; font-weight: 500; }
    .call-time { color: #94a3b8; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; }
    .badge-green { background: #065f46; color: #6ee7b7; }
    .badge-yellow { background: #713f12; color: #fde68a; }
    .firebase-status { text-align: center; margin-bottom: 15px; }
    @media (max-width: 768px) { .charts-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Mailgun MCP Analytics</h1>
    <p>Server uptime: ${getUptime()} | Started: ${new Date(analytics.serverStartTime).toLocaleString()}</p>
    <div class="firebase-status" style="margin-top: 8px;">
      <span class="badge ${firebaseAnalytics.isInitialized() ? "badge-green" : "badge-yellow"}">
        Firebase: ${firebaseAnalytics.isInitialized() ? "Connected" : "Not Configured"}
      </span>
    </div>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="value">${analytics.totalRequests.toLocaleString()}</div>
      <div class="label">Total Requests</div>
    </div>
    <div class="stat-card">
      <div class="value">${analytics.totalToolCalls.toLocaleString()}</div>
      <div class="label">Tool Calls</div>
    </div>
    <div class="stat-card">
      <div class="value">${Object.keys(analytics.toolCalls).length}</div>
      <div class="label">Unique Tools</div>
    </div>
    <div class="stat-card">
      <div class="value">${Object.keys(analytics.clientsByIp).length}</div>
      <div class="label">Unique Clients</div>
    </div>
  </div>

  <div class="charts-grid">
    <div class="chart-card">
      <h3>Tool Usage Distribution</h3>
      <canvas id="toolsChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Hourly Requests (Last 24h)</h3>
      <canvas id="hourlyChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Requests by Endpoint</h3>
      <canvas id="endpointsChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Top Clients by User Agent</h3>
      <canvas id="agentsChart"></canvas>
    </div>
  </div>

  <div class="recent-calls">
    <h3>Recent Tool Calls</h3>
    ${analytics.recentToolCalls
      .slice(0, 15)
      .map(
        (call) => `
      <div class="call-item">
        <span class="call-tool">${call.tool}</span>
        <span class="call-time">${new Date(call.timestamp).toLocaleString()}</span>
      </div>`
      )
      .join("")}
    ${analytics.recentToolCalls.length === 0 ? '<p style="color: #94a3b8; text-align: center; padding: 20px;">No tool calls yet</p>' : ""}
  </div>

  <script>
    const chartColors = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f59e0b', '#06b6d4', '#ec4899', '#14b8a6', '#6366f1'];

    // Tool usage doughnut chart
    new Chart(document.getElementById('toolsChart'), {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(topTools.map(([name]) => name))},
        datasets: [{
          data: ${JSON.stringify(topTools.map(([, count]) => count))},
          backgroundColor: chartColors,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 11 } } } }
      }
    });

    // Hourly requests line chart
    new Chart(document.getElementById('hourlyChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(sortedHours.map(([hour]) => hour.substring(11) + ":00"))},
        datasets: [{
          label: 'Requests',
          data: ${JSON.stringify(sortedHours.map(([, count]) => count))},
          borderColor: '#f97316',
          backgroundColor: 'rgba(249, 115, 22, 0.1)',
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' }, beginAtZero: true }
        }
      }
    });

    // Endpoints bar chart
    new Chart(document.getElementById('endpointsChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(topEndpoints.map(([name]) => name))},
        datasets: [{
          label: 'Requests',
          data: ${JSON.stringify(topEndpoints.map(([, count]) => count))},
          backgroundColor: '#3b82f6'
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' }, beginAtZero: true }
        }
      }
    });

    // User agents horizontal bar chart
    new Chart(document.getElementById('agentsChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(topAgents.map(([name]) => name))},
        datasets: [{
          label: 'Requests',
          data: ${JSON.stringify(topAgents.map(([, count]) => count))},
          backgroundColor: '#10b981'
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' }, beginAtZero: true },
          y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#334155' } }
        }
      }
    });

    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

// MCP endpoint - handle all MCP protocol requests
app.all("/mcp", async (req: Request, res: Response) => {
  // Fix Accept header for MCP SDK compatibility
  const acceptHeader = req.headers["accept"] || "";
  if (!acceptHeader.includes("text/event-stream")) {
    req.headers["accept"] = acceptHeader
      ? `${acceptHeader}, text/event-stream`
      : "text/event-stream";
  }

  trackRequest(req, "/mcp");

  // Track tool calls
  if (req.body && req.body.method === "tools/call" && req.body.params?.name) {
    trackToolCall(req.body.params.name, req);
  }

  try {
    // Get API credentials from query params, headers, or env vars
    const apiKey =
      (req.query.apiKey as string) ||
      (req.headers["x-mailgun-api-key"] as string) ||
      DEFAULT_API_KEY;
    const region = (
      (req.query.region as string) ||
      (req.headers["x-mailgun-region"] as string) ||
      DEFAULT_REGION
    ).toLowerCase();

    if (!apiKey) {
      res.status(400).json({
        error: "Missing API key",
        message:
          "Provide Mailgun API key via query parameter (apiKey), header (X-Mailgun-Api-Key), or environment variable (MAILGUN_API_KEY)",
        example: "/mcp?apiKey=YOUR_API_KEY&region=us",
      });
      return;
    }

    // Create MCP server with credentials
    const mcpServer = createMailgunMcpServer(apiKey, region);

    // Create transport per request (stateless mode)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close();
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request error:", error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: "Internal server error", details: String(error) });
    }
  }
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  clearInterval(saveInterval);
  saveAnalytics(); // Save to local file
  if (firebaseAnalytics.isInitialized()) {
    await firebaseAnalytics.saveAnalytics(analytics); // Save to Firebase
  }
  console.log("Analytics saved. Goodbye!");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start server
app.listen(PORT, HOST, () => {
  console.log(
    `\n🚀 Mailgun MCP Server (HTTP) running on http://${HOST}:${PORT}`
  );
  console.log(`   Health: http://${HOST}:${PORT}/health`);
  console.log(`   MCP:    http://${HOST}:${PORT}/mcp`);
  console.log(`   Analytics: http://${HOST}:${PORT}/analytics`);
  console.log(`   Dashboard: http://${HOST}:${PORT}/analytics/dashboard`);
  console.log(`\n📊 Analytics will be saved to: ${ANALYTICS_FILE}`);
});
