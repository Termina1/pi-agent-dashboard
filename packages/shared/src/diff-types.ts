/**
 * Types for the session file diff API.
 */

/** A single edit operation (oldText → newText replacement) */
export interface EditOperation {
  oldText: string;
  newText: string;
}

/** An individual file change event extracted from session events */
export interface FileChangeEvent {
  /** "edit" or "write" */
  type: "edit" | "write";
  /** Event timestamp (ms since epoch) */
  timestamp: number;
  /** Truncated assistant message preceding this change (reason/context) */
  message?: string;
  /** Edit operations (only for exact-text edit requests) */
  edits?: EditOperation[];
  /** Written content (only for type "write") */
  content?: string;
  /** Tool-provided display diff or patch (from result.details.diff/patch) */
  diff?: string;
  /** Line number of the first change in the new file, when provided by the tool */
  firstChangedLine?: number;
}

/** A file entry with all its change events */
export interface FileDiffEntry {
  /** File path relative to cwd */
  path: string;
  /** Individual change events, ordered by timestamp */
  changes: FileChangeEvent[];
  /** Aggregate git diff (unified format) when available */
  gitDiff?: string;
}

/** Response from GET /api/session-diff */
export interface SessionDiffResponse {
  /** Changed files with their change events */
  files: FileDiffEntry[];
  /** Whether the session cwd is a git repository */
  isGitRepo: boolean;
}
