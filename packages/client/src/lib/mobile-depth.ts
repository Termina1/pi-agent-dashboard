/** Inputs for computing mobile navigation depth */
export interface MobileDepthInput {
  selectedId?: string;
  folderTermCwd?: string | null;
  folderEditorCwd?: string | null;
  settingsMatch?: boolean;
  tunnelSetupMatch?: boolean;
  hasPreview?: boolean;
}

/**
 * Compute MobileShell depth: 0 = list, 1 = detail, 2 = preview.
 */
export function getMobileDepth(input: MobileDepthInput): number {
  if (input.hasPreview) return 2;
  if (input.selectedId || input.folderTermCwd || input.folderEditorCwd || input.settingsMatch || input.tunnelSetupMatch) return 1;
  return 0;
}
