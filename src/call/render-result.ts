function hasRenderableContent(value: unknown): value is {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; mimeType: string; data: string }
    | { type: 'audio'; mimeType: string; data: string }
    | Record<string, unknown>
  >;
  structuredContent?: unknown;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

function renderStructuredValue(value: unknown, indent = 0): void {
  const prefix = ' '.repeat(indent);

  if (value === null || value === undefined) {
    console.log(`${prefix}${String(value)}`);
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      console.log(`${prefix}[]`);
      return;
    }

    for (const item of value) {
      if (item !== null && typeof item === 'object') {
        const entries = Object.entries(item);
        if (entries.length === 0) {
          console.log(`${prefix}- {}`);
          continue;
        }

        const [firstKey, firstValue] = entries[0]!;
        if (firstValue !== null && typeof firstValue === 'object') {
          console.log(`${prefix}- ${firstKey}:`);
          renderStructuredValue(firstValue, indent + 4);
        } else {
          console.log(`${prefix}- ${firstKey}: ${String(firstValue)}`);
        }

        for (const [key, entryValue] of entries.slice(1)) {
          if (entryValue !== null && typeof entryValue === 'object') {
            console.log(`${prefix}  ${key}:`);
            renderStructuredValue(entryValue, indent + 4);
          } else {
            console.log(`${prefix}  ${key}: ${String(entryValue)}`);
          }
        }
      } else {
        console.log(`${prefix}- ${String(item)}`);
      }
    }
    return;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      console.log(`${prefix}{}`);
      return;
    }

    for (const [key, entryValue] of entries) {
      if (entryValue !== null && typeof entryValue === 'object') {
        console.log(`${prefix}${key}:`);
        renderStructuredValue(entryValue, indent + 2);
      } else {
        console.log(`${prefix}${key}: ${String(entryValue)}`);
      }
    }
    return;
  }

  console.log(`${prefix}${String(value)}`);
}

export function renderDefaultResult(result: unknown): void {
  if (!hasRenderableContent(result)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.structuredContent !== undefined) {
    renderStructuredValue(result.structuredContent);
    return;
  }

  for (const item of result.content) {
    if (item.type === 'text') {
      console.log(item.text);
    } else if (item.type === 'image') {
      const data = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
      console.log(`[image ${item.mimeType}, ${data.length} bytes base64]`);
    } else if (item.type === 'audio') {
      const data = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
      console.log(`[audio ${item.mimeType}, ${data.length} bytes base64]`);
    } else {
      console.log(JSON.stringify(item, null, 2));
    }
  }
}
