/**
 * Provider Adapter for OpenCode Swarm Plugin
 * 
 * Handles provider resolution for agent definitions:
 * - "opencode" provider: removes model field (OpenCode Runtime injects current model)
 * - "manual" provider: keeps model field unchanged (hardcoded models)
 * 
 * NO external dependencies - only node:fs and node:path
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Provider Konfiguration
 * 
 * Nur provider Name - keine Modellnamen, keine Defaults, keine Logik.
 */
export interface ProviderConfig {
  provider: "opencode" | "manual";
}

/**
 * Aktualisiert Agent-Definition basierend auf Provider
 * 
 * Wenn provider === "opencode":
 *   - Entfernt das model-Feld komplett
 *   - OpenCode Runtime nutzt dann automatisch aktuelles Modell
 * 
 * Wenn provider === "manual":
 *   - Behält das model-Feld unverändert
 *   - Hartkodierte Werte werden genutzt
 * 
 * @param originalAgent - Ursprüngliche Agent-Definition mit model: Feld
 * @param config - Provider Konfiguration
 * @returns Aktualisierte Agent-Definition
 */
export function getAgentDefinition(
  originalAgent: string,
  config: ProviderConfig
): string {
  if (config.provider === "opencode") {
    return removeModelField(originalAgent);
  }
  
  // manual: model-Feld bleibt unverändert
  return originalAgent;
}

/**
 * Entfernt das model-Feld aus YAML Frontmatter
 * 
 * Entfernt Zeilen die mit "model:" starten (ignoriert Einrückungen)
 * 
 * @param agentDefinition - Agent-Definition als String
 * @returns Agent-Definition ohne model: Zeile
 */
function removeModelField(agentDefinition: string): string {
  return agentDefinition
    .split('\n')
    .filter(line => !line.trim().startsWith('model:'))
    .join('\n');
}

/**
 * Lädt Swarm-Config aus Projektverzeichnis
 * 
 * Gibt null zurück wenn Config nicht existiert oder invalide ist.
 * Null bedeutet "no config = manual behavior" (Backward Compatible)
 * 
 * @param projectPath - Projektverzeichnis
 * @returns ProviderConfig oder null
 */
export function loadSwarmConfig(
  projectPath: string
): ProviderConfig | null {
  const configPath = join(projectPath, ".opencode", "swarm-config.json");
  
  if (!existsSync(configPath)) {
    return null;  // Keine Config = manual behavior
  }
  
  try {
    const config: ProviderConfig = JSON.parse(
      readFileSync(configPath, "utf-8")
    );
    
    // Validiere provider-Feld
    if (config.provider !== "opencode" && config.provider !== "manual") {
      return null;
    }
    
    return config;
  } catch (error) {
    console.warn(`Failed to load swarm config: ${error}`);
    return null;
  }
}
