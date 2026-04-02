/**
 * Model Selection Module
 *
 * Determines which model a worker agent should use based on subtask
 * characteristics like file types and complexity.
 *
 * Priority:
 * 1. Explicit model field in subtask (supports vendor/model format)
 * 2. File-type inference (docs/tests → lite model)
 * 3. Mixed files or implementation → worker model
 * 4. Default to worker model
 *
 * Vendor Support:
 * - Anthropic: claude-sonnet-4.5, claude-opus-4.5, claude-haiku-4-5
 * - OpenAI: gpt-4o, gpt-4o-mini
 * - Google: gemini-2.0-flash, gemini-1.5-pro
 * - Z.AI: glm-4.7, glm-4.6, glm-4.32b
 * - MiniMax: minimax/MiniMax-M2.7, minimax/MiniMax-M2.7-highspeed
 */

import type { DecomposedSubtask } from "./schemas/task";

/**
 * Model vendors
 */
export type ModelVendor = "anthropic" | "openai" | "google" | "zai" | "minimax";

/**
 * Unified model representation with vendor information
 */
export interface VendorModel {
  vendor: ModelVendor;
  model: string;
  displayName: string;
}

/**
 * Configuration interface for swarm models
 *
 * Existing fields (for backward compatibility):
 * - primaryModel: string (fallback if no vendor specified)
 * - liteModel?: string (fallback if no vendor specified)
 *
 * New vendor-specific fields:
 * - coordinatorVendor?: ModelVendor
 * - coordinatorModel?: string
 * - workerVendor?: ModelVendor
 * - workerModel?: string
 * - liteVendor?: ModelVendor
 * - liteModel?: string
 */
export interface SwarmConfig {
  // Legacy fields (backward compatible)
  primaryModel?: string;
  liteModel?: string;

  // New vendor-specific fields
  coordinatorVendor?: ModelVendor;
  coordinatorModel?: string;
  workerVendor?: ModelVendor;
  workerModel?: string;
  liteVendor?: ModelVendor;
  liteModel?: string;
}

/**
 * Parse model string into VendorModel
 * Supports formats:
 * - Legacy: "anthropic/claude-sonnet-4-5"
 * - New: "zai/glm-4.7"
 */
function parseModelString(modelString: string): VendorModel {
  const parts = modelString.split("/");
  
  // If no slash, assume legacy format (backward compatible)
  if (parts.length === 1) {
    return {
      vendor: "anthropic", // Default assumption for legacy
      model: modelString,
      displayName: modelString
    };
  }
  
  // Vendor-aware parsing
  if (parts.length === 2) {
    const vendor = parts[0] as ModelVendor;
    const model = parts[1];
    
    // Build display name
    let displayName = `${vendor}/${model}`;
    if (vendor === "minimax") {
      displayName = model.replace("MiniMax-", "MiniMax ");
    }
    
    return { vendor, model, displayName };
  }
  
  throw new Error(`Invalid model format: ${modelString}`);
}

/**
 * Get default model for a vendor
 */
function getDefaultForVendor(vendor: ModelVendor): string {
  switch (vendor) {
    case "anthropic":
      return "claude-sonnet-4.5"; // Default coordinator
    case "openai":
      return "gpt-4o"; // Default worker
    case "google":
      return "gemini-2.0-flash"; // Default lite
    case "zai":
      return "glm-4.7"; // Default worker
    case "minimax":
      return "minimax/MiniMax-M2.7"; // Default lite
    default:
      return "claude-sonnet-4.5"; // Fallback
  }
}

/**
 * Get display name for a vendor/model pair
 */
function getModelDisplayName(vendor: ModelVendor, model: string): string {
  const shortVendor = vendor === "minimax" ? "MiniMax" : vendor;
  return `${shortVendor}/${model}`;
}

/**
 * Select appropriate model for a worker agent based on subtask characteristics
 *
 * Priority order:
 * 1. Explicit model field in subtask (if present)
 * 2. File-type inference:
 *    - All .md/.mdx files → lite model
 *    - All .test./.spec. files → lite model
 * 3. Mixed files or implementation → worker model
 * 4. Default to worker model
 *
 * @param subtask - The subtask to evaluate
 * @param config - Swarm configuration with model preferences
 * @returns VendorModel object with vendor, model, and display name
 */
export function selectWorkerModel(
  subtask: DecomposedSubtask & { model?: string },
  config: SwarmConfig,
): VendorModel {
  // Priority 1: Explicit model field (supports vendor/model format)
  if (subtask.model) {
    return parseModelString(subtask.model);
  }

  const files = subtask.files || [];

  // Priority 2: File-type inference
  if (files.length > 0) {
    const allDocs = files.every((f) => {
      const lower = f.toLowerCase();
      return lower.endsWith(".md") || lower.endsWith(".mdx");
    });

    const allTests = files.every((f) => {
      const lower = f.toLowerCase();
      return lower.includes(".test.") || lower.includes(".spec.");
    });

    if (allDocs || allTests) {
      // Use lite model if configured, otherwise fall back to lite vendor default
      const liteVendor = config.liteVendor || config.workerVendor || "anthropic";
      const liteModel = config.liteModel || getDefaultForVendor(liteVendor);
      const parsedLiteModel = parseModelString(liteModel);
      
      return {
        vendor: parsedLiteModel.vendor,
        model: parsedLiteModel.model,
        displayName: parsedLiteModel.displayName
      };
    }
  }

  // Priority 3: Default to worker model
  const workerVendor = config.workerVendor || "anthropic";
  const workerModel = config.workerModel || getDefaultForVendor(workerVendor);
  
  return {
    vendor: workerVendor,
    model: workerModel,
    displayName: getModelDisplayName(workerVendor, workerModel)
  };
}
