#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import https from "node:https";
import yaml from "js-yaml";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

// Resolve directory path when using ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Configuration & Types
// ============================================================

export interface MailgunConfig {
  apiKey: string;
  region: string;
  hostname: string;
}

export function getHostname(region: string): string {
  return region === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
}

/**
 * Finds the OpenAPI YAML spec file.
 * Works both from compiled dist/ and from src/ with tsx.
 */
export function findOpenApiSpec(): string {
  // When running compiled code from dist/
  const fromDist = path.resolve(__dirname, "..", "src", "openapi.yaml");
  if (fs.existsSync(fromDist)) return fromDist;

  // When running from src/ with tsx
  const fromSrc = path.resolve(__dirname, "openapi.yaml");
  if (fs.existsSync(fromSrc)) return fromSrc;

  throw new Error("Could not find openapi.yaml");
}

// ============================================================
// Define Mailgun API endpoints supported by this integration
// ============================================================

export const endpoints = [
    // Messages
    "POST /v3/{domain_name}/messages",
    "GET /v3/domains/{domain_name}/messages/{storage_key}",
    "POST /v3/domains/{domain_name}/messages/{storage_key}",

    // Domains
    "GET /v4/domains",
    "GET /v4/domains/{name}",
    "PUT /v4/domains/{name}/verify",
    "GET /v3/domains/{name}/sending_queues",

    // Domain Tracking
    "GET /v3/domains/{name}/tracking",
    "PUT /v3/domains/{name}/tracking/click",
    "PUT /v3/domains/{name}/tracking/open",
    "PUT /v3/domains/{name}/tracking/unsubscribe",

    // Webhooks
    "GET /v3/domains/{domain}/webhooks",
    "POST /v3/domains/{domain}/webhooks",
    "GET /v3/domains/{domain_name}/webhooks/{webhook_name}",
    "PUT /v3/domains/{domain_name}/webhooks/{webhook_name}",

    // IPs & IP Pools
    "GET /v5/accounts/subaccounts/ip_pools/all",
    "GET /v3/ips",
    "GET /v3/ips/{ip}",
    "GET /v3/ips/{ip}/domains",
    "GET /v3/ip_pools",
    "GET /v3/ip_pools/{pool_id}",
    "GET /v3/ip_pools/{pool_id}/domains",

    // Tags
    "GET /v3/{domain}/tags",
    "GET /v3/{domain}/tag",
    "GET /v3/{domain}/tag/stats/aggregates",
    "GET /v3/{domain}/tag/stats",
    "GET /v3/domains/{domain}/tag/devices",
    "GET /v3/domains/{domain}/tag/providers",
    "GET /v3/domains/{domain}/tag/countries",
    "GET /v3/domains/{domain}/limits/tag",

    // Stats & Aggregates
    "GET /v3/stats/total",
    "GET /v3/{domain}/stats/total",
    "GET /v3/stats/total/domains",
    "GET /v3/stats/filter",
    "GET /v3/{domain}/aggregates/providers",
    "GET /v3/{domain}/aggregates/devices",
    "GET /v3/{domain}/aggregates/countries",

    // Analytics
    "POST /v1/analytics/metrics",
    "POST /v1/analytics/usage/metrics",
    "POST /v1/analytics/logs",

    // Suppressions - Bounces
    "GET /v3/{domain_name}/bounces/{address}",
    "GET /v3/{domain_name}/bounces",

    // Suppressions - Unsubscribes
    "GET /v3/{domain_name}/unsubscribes/{address}",
    "GET /v3/{domain_name}/unsubscribes",

    // Suppressions - Complaints
    "GET /v3/{domain_name}/complaints/{address}",
    "GET /v3/{domain_name}/complaints",

    // Suppressions - Allowlist
    "GET /v3/{domain_name}/whitelists/{value}",
    "GET /v3/{domain_name}/whitelists",

    // Routes
    "GET /v3/routes",
    "GET /v3/routes/{id}",
    "PUT /v3/routes/{id}",

    // Mailing Lists
    "GET /v3/lists",
    "POST /v3/lists",
    "GET /v3/lists/{list_address}",
    "PUT /v3/lists/{list_address}",
    "GET /v3/lists/{list_address}/members",
    "POST /v3/lists/{list_address}/members",
    "GET /v3/lists/{list_address}/members/{member_address}",
    "PUT /v3/lists/{list_address}/members/{member_address}",

    // Templates
    "GET /v3/{domain_name}/templates",
    "POST /v3/{domain_name}/templates",
    "GET /v3/{domain_name}/templates/{template_name}",
    "PUT /v3/{domain_name}/templates/{template_name}",
    "GET /v3/{domain_name}/templates/{template_name}/versions",
    "POST /v3/{domain_name}/templates/{template_name}/versions",
    "GET /v3/{domain_name}/templates/{template_name}/versions/{version_name}",
    "PUT /v3/{domain_name}/templates/{template_name}/versions/{version_name}",

    // Bounce Classification
    "GET /v1/bounce-classification/stats",
    "POST /v2/bounce-classification/metrics",

    // Account Limits
    "GET /v5/accounts/limit/custom/monthly",
];

// ============================================================
// Mailgun API Client
// ============================================================

/**
 * Makes an authenticated request to the Mailgun API
 * @param method - HTTP method (GET, POST, etc.)
 * @param urlPath - API endpoint path
 * @param data - Request payload data (for POST/PUT requests)
 * @param contentType - Content type for the request body
 * @param apiKey - Mailgun API key
 * @param hostname - Mailgun API hostname
 * @returns Response data as JSON
 */
export async function makeMailgunRequest(
  method: string,
  urlPath: string,
  data: Record<string, any> | null = null,
  contentType: string = "application/x-www-form-urlencoded",
  apiKey: string,
  hostname: string
): Promise<any> {
  return new Promise((resolve, reject) => {
    // Normalize path format (handle paths with or without leading slash)
    const cleanPath = urlPath.startsWith("/") ? urlPath.substring(1) : urlPath;

    // Create basic auth credentials from API key
    const auth = Buffer.from(`api:${apiKey}`).toString("base64");
    const options: https.RequestOptions = {
      hostname,
      path: `/${cleanPath}`,
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": contentType,
      },
    };

    // Create and send the HTTP request
    const req = https.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk: Buffer) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const parsedData = JSON.parse(responseData);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsedData);
          } else {
            reject(
              new Error(
                `Mailgun API error: ${parsedData.message || responseData}`
              )
            );
          }
        } catch (e: any) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    // For non-GET requests, serialize and send the body
    if (data && method !== "GET") {
      if (contentType === "application/json") {
        req.write(JSON.stringify(data));
      } else {
        // Default to URL encoded form data
        const formData = new URLSearchParams();
        for (const [key, value] of Object.entries(data)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              formData.append(key, item);
            }
          } else if (value !== undefined && value !== null) {
            formData.append(key, value.toString());
          }
        }
        req.write(formData.toString());
      }
    }

    req.end();
  });
}

// ============================================================
// OpenAPI Utilities
// ============================================================

/**
 * Loads and parses the OpenAPI specification from a YAML file
 * @param filePath - Path to the OpenAPI YAML file
 * @returns Parsed OpenAPI specification
 */
export function loadOpenApiSpec(filePath: string): any {
  try {
    const fileContents = fs.readFileSync(filePath, "utf8");
    return yaml.load(fileContents);
  } catch (error: any) {
    console.error(`Error loading OpenAPI spec: ${error.message}`);
    // Don't exit in test mode
    if (process.env.NODE_ENV !== "test") {
      process.exit(1);
    }
    throw error; // Throw so tests can catch it
  }
}

/**
 * Converts OpenAPI schema definitions to Zod validation schemas
 * @param schema - OpenAPI schema object
 * @param fullSpec - Complete OpenAPI specification
 * @returns Corresponding Zod schema
 */
export function openapiToZod(schema: any, fullSpec: any): z.ZodType<any> {
  if (!schema) return z.any();

  // Handle schema references (e.g. #/components/schemas/...)
  if (schema.$ref) {
    // For #/components/schemas/EventSeverityType type references
    if (schema.$ref.startsWith("#/")) {
      const refPath = schema.$ref.substring(2).split("/");

      // Navigate through the object using the path segments
      let referenced: any = fullSpec;
      for (const segment of refPath) {
        if (!referenced || !referenced[segment]) {
          // If we can't resolve it but know it's EventSeverityType, use our knowledge
          if (
            segment === "EventSeverityType" ||
            schema.$ref.endsWith("EventSeverityType")
          ) {
            return z
              .enum(["temporary", "permanent"])
              .describe("Filter by event severity");
          }

          console.error(
            `Failed to resolve reference: ${schema.$ref}, segment: ${segment}`
          );
          return z.any().describe(`Failed reference: ${schema.$ref}`);
        }
        referenced = referenced[segment];
      }

      return openapiToZod(referenced, fullSpec);
    }

    // Handle other reference formats if needed
    console.error(`Unsupported reference format: ${schema.$ref}`);
    return z.any().describe(`Unsupported reference: ${schema.$ref}`);
  }

  // Convert different schema types to Zod equivalents
  switch (schema.type) {
    case "string": {
      let zodString = z.string();
      if (schema.enum) {
        return z.enum(schema.enum);
      }
      if (schema.format === "email") {
        zodString = zodString.email();
      }
      if (schema.format === "uri") {
        zodString = zodString.describe(`URI: ${schema.description || ""}`);
      }
      return zodString.describe(schema.description || "");
    }

    case "number":
    case "integer": {
      let zodNumber = z.number();
      if (schema.minimum !== undefined) {
        zodNumber = zodNumber.min(schema.minimum);
      }
      if (schema.maximum !== undefined) {
        zodNumber = zodNumber.max(schema.maximum);
      }
      return zodNumber.describe(schema.description || "");
    }

    case "boolean":
      return z.boolean().describe(schema.description || "");

    case "array":
      return z
        .array(openapiToZod(schema.items, fullSpec))
        .describe(schema.description || "");

    case "object": {
      if (!schema.properties) return z.record(z.any());

      const shape: Record<string, z.ZodType<any>> = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        shape[key] = schema.required?.includes(key)
          ? openapiToZod(prop, fullSpec)
          : openapiToZod(prop, fullSpec).optional();
      }
      return z.object(shape).describe(schema.description || "");
    }

    default:
      // For schemas without a type but with properties
      if (schema.properties) {
        const shape: Record<string, z.ZodType<any>> = {};
        for (const [key, prop] of Object.entries(schema.properties)) {
          shape[key] = schema.required?.includes(key)
            ? openapiToZod(prop, fullSpec)
            : openapiToZod(prop, fullSpec).optional();
        }
        return z.object(shape).describe(schema.description || "");
      }

      // For YAML that defines "oneOf", "anyOf", etc.
      if (schema.oneOf) {
        const unionTypes = schema.oneOf.map((s: any) =>
          openapiToZod(s, fullSpec)
        );
        if (unionTypes.length >= 2) {
          return z
            .union(
              unionTypes as [
                z.ZodType<any>,
                z.ZodType<any>,
                ...z.ZodType<any>[],
              ]
            )
            .describe(schema.description || "");
        } else if (unionTypes.length === 1) {
          return unionTypes[0].describe(schema.description || "");
        }
        return z.any().describe(schema.description || "");
      }

      if (schema.anyOf) {
        const unionTypes = schema.anyOf.map((s: any) =>
          openapiToZod(s, fullSpec)
        );
        if (unionTypes.length >= 2) {
          return z
            .union(
              unionTypes as [
                z.ZodType<any>,
                z.ZodType<any>,
                ...z.ZodType<any>[],
              ]
            )
            .describe(schema.description || "");
        } else if (unionTypes.length === 1) {
          return unionTypes[0].describe(schema.description || "");
        }
        return z.any().describe(schema.description || "");
      }

      return z.any().describe(schema.description || "");
  }
}

/**
 * Determines the request body content type from an OpenAPI operation
 * @param operation - OpenAPI operation object
 * @returns The content type to use for the request
 */
export function getRequestContentType(operation: any): string {
  if (!operation.requestBody?.content) return "application/x-www-form-urlencoded";

  if (operation.requestBody.content["application/json"])
    return "application/json";

  // Use form-urlencoded even when the spec declares multipart/form-data,
  // since we don't support file uploads and sending a multipart Content-Type
  // without proper boundary encoding causes API errors.
  return "application/x-www-form-urlencoded";
}

/**
 * Retrieves operation details from the OpenAPI spec for a given method and path
 * @param openApiSpec - Parsed OpenAPI specification
 * @param method - HTTP method (GET, POST, etc.)
 * @param urlPath - API endpoint path
 * @returns Operation details or null if not found
 */
export function getOperationDetails(
  openApiSpec: any,
  method: string,
  urlPath: string
): { operation: any; operationId: string } | null {
  const lowerMethod = method.toLowerCase();

  if (!openApiSpec.paths?.[urlPath]?.[lowerMethod]) {
    return null;
  }

  return {
    operation: openApiSpec.paths[urlPath][lowerMethod],
    operationId: `${method}-${urlPath.replace(/[^\w-]/g, "-").replace(/-+/g, "-")}`,
  };
}

/**
 * Sanitizes a property key to match the Anthropic API requirement: ^[a-zA-Z0-9_.-]{1,64}
 * Replaces any disallowed character with an underscore and truncates to 64 characters.
 * @param key - The property key to sanitize
 * @returns Sanitized property key
 */
export function sanitizePropertyKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
}

/**
 * Sanitizes an operation ID to be used as a tool ID
 * @param operationId - The operation ID to sanitize
 * @returns Sanitized tool ID
 */
export function sanitizeToolId(operationId: string): string {
  // MCP protocol limits tool names to 64 characters
  // Strip leading/trailing dashes to conform to MCP tool naming standard
  return operationId
    .replace(/[^\w-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 64);
}

/**
 * Builds a Zod parameter schema from an OpenAPI operation
 * @param operation - OpenAPI operation object
 * @param openApiSpec - Complete OpenAPI specification
 * @returns Zod parameter schema and key mapping
 */
export function buildParamsSchema(
  operation: any,
  openApiSpec: any
): {
  paramsSchema: Record<string, z.ZodType<any>>;
  keyMapping: Record<string, string>;
} {
  const paramsSchema: Record<string, z.ZodType<any>> = {};
  const keyMapping: Record<string, string> = {};

  // Process path parameters
  const pathParams =
    operation.parameters?.filter((p: any) => p.in === "path") || [];
  processParameters(pathParams, paramsSchema, openApiSpec, keyMapping);

  // Process query parameters
  const queryParams =
    operation.parameters?.filter((p: any) => p.in === "query") || [];
  processParameters(queryParams, paramsSchema, openApiSpec, keyMapping);

  // Process request body if it exists
  if (operation.requestBody) {
    processRequestBody(
      operation.requestBody,
      paramsSchema,
      openApiSpec,
      keyMapping
    );
  }

  return { paramsSchema, keyMapping };
}

/**
 * Processes OpenAPI parameters into Zod schemas
 * @param parameters - OpenAPI parameter objects
 * @param paramsSchema - Target schema object to populate
 * @param openApiSpec - Complete OpenAPI specification
 * @param keyMapping - Map of sanitized key → original key (populated for keys that changed)
 */
export function processParameters(
  parameters: any[],
  paramsSchema: Record<string, z.ZodType<any>>,
  openApiSpec: any,
  keyMapping: Record<string, string> = {}
): void {
  for (const param of parameters) {
    const sanitizedKey = sanitizePropertyKey(param.name);
    if (sanitizedKey !== param.name) {
      keyMapping[sanitizedKey] = param.name;
    }
    const zodParam = openapiToZod(param.schema, openApiSpec);
    paramsSchema[sanitizedKey] = param.required
      ? zodParam
      : zodParam.optional();
  }
}

/**
 * Processes request body schema into Zod schemas
 * @param requestBody - OpenAPI request body object
 * @param paramsSchema - Target schema object to populate
 * @param openApiSpec - Complete OpenAPI specification
 * @param keyMapping - Map of sanitized key → original key (populated for keys that changed)
 */
export function processRequestBody(
  requestBody: any,
  paramsSchema: Record<string, z.ZodType<any>>,
  openApiSpec: any,
  keyMapping: Record<string, string> = {}
): void {
  if (!requestBody.content) return;

  // Try different content types in priority order
  const contentTypes = [
    "application/json",
    "multipart/form-data",
    "application/x-www-form-urlencoded",
  ];

  for (const contentType of contentTypes) {
    if (!requestBody.content[contentType]) continue;

    let bodySchema = requestBody.content[contentType].schema;

    // Handle schema references
    if (bodySchema.$ref) {
      bodySchema = resolveReference(bodySchema.$ref, openApiSpec);
    }

    // Process schema properties
    if (bodySchema?.properties) {
      for (const [prop, schema] of Object.entries(bodySchema.properties)) {
        let propSchema = schema as any;

        // Handle nested references
        if (propSchema.$ref) {
          propSchema = resolveReference(propSchema.$ref, openApiSpec);
        }

        const sanitizedKey = sanitizePropertyKey(prop);
        if (sanitizedKey !== prop) {
          keyMapping[sanitizedKey] = prop;
        }

        const zodProp = openapiToZod(propSchema, openApiSpec);
        paramsSchema[sanitizedKey] = bodySchema.required?.includes(prop)
          ? zodProp
          : zodProp.optional();
      }
    }

    break; // We found and processed a content type
  }
}

/**
 * Resolves a schema reference within an OpenAPI spec
 * @param ref - Reference string (e.g. #/components/schemas/ModelName)
 * @param openApiSpec - Complete OpenAPI specification
 * @returns Resolved schema
 */
export function resolveReference(ref: string, openApiSpec: any): any {
  const refPath = ref.replace("#/", "").split("/");
  return refPath.reduce((obj: any, p: string) => obj[p], openApiSpec);
}

// ============================================================
// Path & Parameter Processing
// ============================================================

/**
 * Processes path parameters from the request parameters
 * @param urlPath - API endpoint path with placeholders
 * @param operation - OpenAPI operation object
 * @param params - Request parameters
 * @returns Processed path and remaining parameters
 */
export function processPathParameters(
  urlPath: string,
  operation: any,
  params: Record<string, any>
): { actualPath: string; remainingParams: Record<string, any> } {
  let actualPath = urlPath;
  const pathParams =
    operation.parameters?.filter((p: any) => p.in === "path") || [];
  const remainingParams = { ...params };

  for (const param of pathParams) {
    if (params[param.name]) {
      actualPath = actualPath.replace(
        `{${param.name}}`,
        encodeURIComponent(params[param.name])
      );
      delete remainingParams[param.name];
    } else {
      throw new Error(`Required path parameter '${param.name}' is missing`);
    }
  }

  return { actualPath, remainingParams };
}

/**
 * Separates parameters into query parameters and body parameters
 * @param params - Request parameters
 * @param operation - OpenAPI operation object
 * @param method - HTTP method (GET, POST, etc.)
 * @returns Separated query and body parameters
 */
export function separateParameters(
  params: Record<string, any>,
  operation: any,
  method: string
): { queryParams: Record<string, any>; bodyParams: Record<string, any> } {
  const queryParams: Record<string, any> = {};
  const bodyParams: Record<string, any> = {};

  // Get query parameters from operation definition
  const definedQueryParams =
    operation.parameters
      ?.filter((p: any) => p.in === "query")
      .map((p: any) => p.name) || [];

  // Sort parameters into body or query
  for (const [key, value] of Object.entries(params)) {
    if (definedQueryParams.includes(key)) {
      queryParams[key] = value;
    } else {
      bodyParams[key] = value;
    }
  }

  // For GET requests, move all params to query
  if (method.toUpperCase() === "GET") {
    Object.assign(queryParams, bodyParams);
    Object.keys(bodyParams).forEach((key) => delete bodyParams[key]);
  }

  return { queryParams, bodyParams };
}

/**
 * Appends query string parameters to a path
 * @param urlPath - API endpoint path
 * @param queryParams - Query parameters
 * @returns Path with query string
 */
export function appendQueryString(
  urlPath: string,
  queryParams: Record<string, any>
): string {
  if (Object.keys(queryParams).length === 0) {
    return urlPath;
  }

  const queryString = new URLSearchParams();

  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null) {
      queryString.append(key, value.toString());
    }
  }

  return `${urlPath}?${queryString.toString()}`;
}

// ============================================================
// Tool Registration
// ============================================================

/**
 * Registers a single Mailgun tool on the given MCP server
 */
export function registerTool(
  server: McpServer,
  toolId: string,
  toolDescription: string,
  paramsSchema: Record<string, z.ZodType<any>>,
  method: string,
  urlPath: string,
  operation: any,
  contentType: string,
  keyMapping: Record<string, string>,
  config: MailgunConfig,
  onToolCall?: (toolName: string) => void
): void {
  // Use 'as any' to avoid TS2589: dynamic OpenAPI-derived schemas cause
  // excessively deep type instantiation in the MCP SDK generics.
  (server.tool as any)(
    toolId,
    toolDescription,
    paramsSchema,
    async (params: Record<string, any>) => {
      try {
        if (onToolCall) onToolCall(toolId);

        // Translate sanitized parameter keys back to original Mailgun API names
        const originalParams: Record<string, any> = {};
        for (const [key, value] of Object.entries(params)) {
          const originalKey = keyMapping[key] || key;
          originalParams[originalKey] = value;
        }

        const { actualPath, remainingParams } = processPathParameters(
          urlPath,
          operation,
          originalParams
        );
        const { queryParams, bodyParams } = separateParameters(
          remainingParams,
          operation,
          method
        );
        const finalPath = appendQueryString(actualPath, queryParams);

        // Make the API request
        const result = await makeMailgunRequest(
          method.toUpperCase(),
          finalPath,
          method.toUpperCase() === "GET" ? null : bodyParams,
          contentType,
          config.apiKey,
          config.hostname
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `${method.toUpperCase()} ${finalPath} completed successfully:\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error.message || String(error)}`,
            },
          ],
        };
      }
    }
  );
}

/**
 * Generates and registers all MCP tools from the OpenAPI specification
 * @param server - MCP server to register tools on
 * @param openApiSpec - Parsed OpenAPI specification
 * @param config - Mailgun API configuration
 * @param onToolCall - Optional callback for tracking tool calls
 */
export function generateToolsFromOpenApi(
  server: McpServer,
  openApiSpec: any,
  config: MailgunConfig,
  onToolCall?: (toolName: string) => void
): void {
  for (const endpoint of endpoints) {
    try {
      const [method, urlPath] = endpoint.split(" ");
      const operationDetails = getOperationDetails(openApiSpec, method, urlPath);

      if (!operationDetails) {
        console.warn(
          `Could not match endpoint: ${method} ${urlPath} in OpenAPI spec`
        );
        continue;
      }

      const { operation, operationId } = operationDetails;
      const { paramsSchema, keyMapping } = buildParamsSchema(
        operation,
        openApiSpec
      );
      const toolId = sanitizeToolId(operationId);
      const toolDescription =
        operation.summary || `${method.toUpperCase()} ${urlPath}`;
      const contentType = getRequestContentType(operation);

      registerTool(
        server,
        toolId,
        toolDescription,
        paramsSchema,
        method,
        urlPath,
        operation,
        contentType,
        keyMapping,
        config,
        onToolCall
      );
    } catch (error: any) {
      console.error(
        `Failed to process endpoint ${endpoint}: ${error.message}`
      );
    }
  }
}

/**
 * Creates a fully configured MCP server with all Mailgun tools registered
 * @param apiKey - Mailgun API key
 * @param region - Mailgun API region (us or eu)
 * @param onToolCall - Optional callback for tracking tool calls
 * @returns Configured MCP server
 */
export function createMailgunMcpServer(
  apiKey: string,
  region: string,
  onToolCall?: (toolName: string) => void
): McpServer {
  const hostname = getHostname(region);
  const config: MailgunConfig = { apiKey, region, hostname };

  const server = new McpServer({
    name: "mailgun",
    version: "1.0.0",
  });

  const openApiSpec = loadOpenApiSpec(findOpenApiSpec());
  generateToolsFromOpenApi(server, openApiSpec, config, onToolCall);

  // Add hello/test tool
  server.tool(
    "hello",
    "A simple test tool to verify that the Mailgun MCP server is working correctly",
    {},
    async () => ({
      content: [
        {
          type: "text" as const,
          text: `Hello from Mailgun MCP Server! Region: ${region}, API Host: ${hostname}`,
        },
      ],
    })
  );

  return server;
}
