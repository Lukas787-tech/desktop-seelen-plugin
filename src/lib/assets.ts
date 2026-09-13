import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * Turns an absolute Windows path into a URL the webview can load.
 *
 * Verified against the running host: `convertFileSrc` yields
 * `http://asset.localhost/<encoded path>`, which serves wallpaper files and
 * media album art (both live outside the widget directory) with HTTP 200.
 * Directories return 403, so only ever pass a file.
 */
export function fileUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return convertFileSrc(path);
}

/** Joins a resource directory and filename from the host into one absolute path. */
export function joinPath(dir: string, file: string): string {
  const sep = String.fromCharCode(92); // backslash
  const trimmed = dir.endsWith(sep) || dir.endsWith('/') ? dir.slice(0, -1) : dir;
  return `${trimmed}${sep}${file}`;
}

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.avi', '.mov'];

export function isVideoFile(path: string): boolean {
  const lower = path.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
