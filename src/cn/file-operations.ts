/**
 * File system helpers for the cn sub-command.
 */
import { access, mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await access(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * Check whether a file exists at the given path.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write content to a file, creating parent directories as needed.
 */
export async function writeFileWithDir(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  await ensureDirectoryExists(dir);
  await writeFile(filePath, content, 'utf-8');
}
