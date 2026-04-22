/**
 * Utility functions for the cn (code generation) sub-command.
 */

/**
 * Convert a string to PascalCase.
 * Handles various separators: spaces, hyphens, underscores, and forward slashes.
 */
export function toPascalCase(s: string): string {
  if (!s || typeof s !== 'string') {
    return '';
  }

  // Replace forward slashes with hyphens to handle names like 'example-servers/everything'
  const normalized = s.replace(/\//g, '-');

  // Check if the string already contains separators
  const hasSeparators = /[-_ ]/.test(normalized);

  if (hasSeparators) {
    // Handle strings with separators by splitting and capitalizing each part
    const parts = normalized.split(/[-_ ]+/);

    const pascalCased = parts
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('');

    return pascalCased;
  } else {
    // For strings without separators, just capitalize the first letter
    // and preserve the rest of the string as is
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
}
