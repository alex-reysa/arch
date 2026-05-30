// -------------------------------------------------------------------------
// Source spans / positions
// -------------------------------------------------------------------------

export interface SourceSpan {
  readonly file: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export function spanFrom(
  file: string,
  start: SourcePosition,
  end: SourcePosition,
): SourceSpan {
  return { file, start, end };
}

// -------------------------------------------------------------------------
// Path-safety utility types
//
// Every cross-package API that takes a "path" should accept a branded type
// instead of a raw string, so a project-relative path can never be confused
// with an absolute path or a glob pattern at compile time. The runtime
// constructors normalize separators, refuse traversal segments, and refuse
// `.git/`-prefixed paths.
// -------------------------------------------------------------------------

const ProjectRelativePathBrand: unique symbol = Symbol("ProjectRelativePath");
const AbsolutePathBrand: unique symbol = Symbol("AbsolutePath");
const GlobPatternBrand: unique symbol = Symbol("GlobPattern");

/**
 * A POSIX-style, project-relative path. Never starts with `/`, never contains
 * `..` segments, never starts with `.git/`. Branded so a function that
 * expects a project-relative path cannot accidentally accept an absolute
 * path, a glob, or a raw string.
 */
export type ProjectRelativePath = string & {
  readonly [ProjectRelativePathBrand]: true;
};

/** A platform-absolute path. */
export type AbsolutePath = string & {
  readonly [AbsolutePathBrand]: true;
};

/** A glob pattern (uses `*`, `**`, `?`). Distinct from a literal path. */
export type GlobPattern = string & {
  readonly [GlobPatternBrand]: true;
};

export class PathSafetyError extends Error {
  constructor(message: string, readonly code: PathSafetyErrorCode) {
    super(message);
    this.name = "PathSafetyError";
  }
}

export type PathSafetyErrorCode =
  | "absolute_path_required"
  | "relative_path_required"
  | "traversal_segment"
  | "git_directory"
  | "empty_path";

/**
 * Construct a `ProjectRelativePath` from a raw string. Throws
 * `PathSafetyError` if the value is absolute, escapes the project root, or
 * targets `.git/`.
 */
export function projectRelativePath(raw: string): ProjectRelativePath {
  if (raw.length === 0) {
    throw new PathSafetyError("empty path", "empty_path");
  }
  const normalized = raw.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    throw new PathSafetyError(
      `expected a project-relative path, got absolute: ${raw}`,
      "relative_path_required",
    );
  }
  const parts = normalized.split("/");
  for (const part of parts) {
    if (part === "..") {
      throw new PathSafetyError(
        `path contains traversal segment: ${raw}`,
        "traversal_segment",
      );
    }
  }
  if (parts[0] === ".git" || normalized.startsWith(".git/")) {
    throw new PathSafetyError(
      `path targets .git directory: ${raw}`,
      "git_directory",
    );
  }
  return normalized as ProjectRelativePath;
}

export function absolutePath(raw: string): AbsolutePath {
  if (raw.length === 0) {
    throw new PathSafetyError("empty path", "empty_path");
  }
  const isPosixAbsolute = raw.startsWith("/");
  const isWin32Absolute = /^[A-Za-z]:[\\/]/.test(raw);
  if (!isPosixAbsolute && !isWin32Absolute) {
    throw new PathSafetyError(
      `expected an absolute path, got relative: ${raw}`,
      "absolute_path_required",
    );
  }
  return raw as AbsolutePath;
}

export function globPattern(raw: string): GlobPattern {
  if (raw.length === 0) {
    throw new PathSafetyError("empty path", "empty_path");
  }
  return raw as GlobPattern;
}
