import type { DetectedEditor } from "../../lib/editor-api.js";
import type { ChatImage } from "../../lib/event-reducer.js";

/** Context passed to every tool renderer */
export interface ToolContext {
  sessionId?: string;
  cwd?: string;
  editors: DetectedEditor[];
  plannotatorPort?: number;
}

/** Props every tool renderer receives */
export interface ToolRendererProps {
  toolName: string;
  args?: Record<string, unknown>;
  status: "running" | "complete" | "error";
  result?: string;
  images?: ChatImage[];
  context: ToolContext;
  /** Structured metadata from tool (e.g. AgentDetails from pi-subagents) */
  toolDetails?: Record<string, unknown>;
}

/** A tool renderer is a React component matching this signature */
export type ToolRenderer = React.ComponentType<ToolRendererProps>;
