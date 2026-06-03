import * as os from "node:os";
import * as path from "node:path";
import {
  getDefaultRegistry,
  type ToolRegistry,
} from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";

const BLOCKED_EXTENSION_PACKAGES = new Set(["@lpirito/pi-diffloop", "pi-diffloop"]);

export interface DashboardExtensionResource {
  path: string;
  enabled: boolean;
  metadata: {
    source: string;
    scope: string;
    origin: string;
    baseDir?: string;
  };
}

interface PiModule {
  DefaultPackageManager: new (options: {
    cwd: string;
    agentDir: string;
    settingsManager: unknown;
  }) => {
    resolve: (onMissing?: (source: string) => Promise<"install" | "skip" | "error">) => Promise<{
      extensions: DashboardExtensionResource[];
    }>;
  };
  SettingsManager: {
    create: (cwd: string, agentDir?: string) => unknown;
  };
}

function normalizeNpmPackageName(source: string): string {
  const withoutPrefix = source.startsWith("npm:") ? source.slice("npm:".length) : source;
  if (withoutPrefix.startsWith("@")) {
    const match = withoutPrefix.match(/^(@[^/]+\/[^@]+)(?:@.*)?$/);
    return match?.[1] ?? withoutPrefix;
  }
  return withoutPrefix.replace(/@[^@/]+$/, "");
}

function hasPathSegment(value: string | undefined, segment: string): boolean {
  if (!value) return false;
  return value.split(/[\\/]+/).includes(segment);
}

export function isDashboardBlockedExtensionResource(resource: DashboardExtensionResource): boolean {
  const sourceName = normalizeNpmPackageName(resource.metadata.source);
  if (BLOCKED_EXTENSION_PACKAGES.has(sourceName)) return true;

  const baseDirName = resource.metadata.baseDir ? path.basename(resource.metadata.baseDir) : undefined;
  if (baseDirName && BLOCKED_EXTENSION_PACKAGES.has(baseDirName)) return true;

  return hasPathSegment(resource.path, "pi-diffloop") && path.basename(resource.path) === "diffloop.ts";
}

export function buildDashboardExtensionArgsFromResources(resources: DashboardExtensionResource[]): string[] {
  const hasBlockedEnabledExtension = resources.some(
    (resource) => resource.enabled && isDashboardBlockedExtensionResource(resource),
  );
  if (!hasBlockedEnabledExtension) return [];

  const args = ["--no-extensions"];
  for (const resource of resources) {
    if (!resource.enabled || isDashboardBlockedExtensionResource(resource)) continue;
    args.push("--extension", resource.path);
  }
  return args;
}

export async function resolveDashboardExtensionArgs(
  cwd: string,
  registry: ToolRegistry = getDefaultRegistry(),
): Promise<string[]> {
  try {
    const { module } = await registry.resolveModule<PiModule>("pi-coding-agent");
    if (!module.DefaultPackageManager || !module.SettingsManager?.create) return [];

    const agentDir = path.join(os.homedir(), ".pi", "agent");
    const settingsManager = module.SettingsManager.create(cwd, agentDir);
    const packageManager = new module.DefaultPackageManager({ cwd, agentDir, settingsManager });
    const resolved = await packageManager.resolve(async () => "skip");
    return buildDashboardExtensionArgsFromResources(resolved.extensions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[spawn] Failed to resolve dashboard extension filter; pi-diffloop may load: ${message}`);
    return [];
  }
}
