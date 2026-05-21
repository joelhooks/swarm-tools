declare module "openclaw/plugin-sdk" {
  export interface OpenClawPluginApi {
    pluginConfig?: unknown
    registerTool(tool: {
      name: string
      label?: string
      description?: string
      parameters?: Record<string, unknown>
      execute: (toolCallId: string, args: Record<string, unknown>) => unknown | Promise<unknown>
    }): void
    on(event: string, handler: (event: Record<string, unknown>) => unknown | Promise<unknown>): void
  }
}
