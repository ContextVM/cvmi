import matter from 'gray-matter';

/** Parse skill metadata without executing JavaScript frontmatter. */
export function parseSkillFrontmatter(content: string): ReturnType<typeof matter> {
  return matter(content, {
    engines: {
      javascript: () => {
        throw new Error('JavaScript skill frontmatter is not supported');
      },
    },
  });
}
