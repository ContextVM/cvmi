import type { Tool } from '@modelcontextprotocol/sdk/types.js';

function formatSchemaType(schema: Record<string, unknown> | undefined): string {
  if (!schema) return 'unknown';

  if (typeof schema.type === 'string') {
    if (schema.type === 'array') {
      const itemType = formatSchemaType(
        schema.items && typeof schema.items === 'object'
          ? (schema.items as Record<string, unknown>)
          : undefined
      );
      return `${itemType}[]`;
    }

    return schema.type;
  }

  if (Array.isArray(schema.type) && schema.type.every((value) => typeof value === 'string')) {
    return schema.type.join(' | ');
  }

  if (Array.isArray(schema.anyOf)) {
    const variants = schema.anyOf
      .filter(
        (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
      )
      .map((entry) => formatSchemaType(entry));
    if (variants.length > 0) {
      return variants.join(' | ');
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const variants = schema.oneOf
      .filter(
        (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
      )
      .map((entry) => formatSchemaType(entry));
    if (variants.length > 0) {
      return variants.join(' | ');
    }
  }

  if (schema.properties && typeof schema.properties === 'object') {
    return 'object';
  }

  return 'unknown';
}

function renderNestedSchemaProperties(schema: Record<string, unknown>, indent: number): void {
  const properties =
    schema.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, unknown>)
      : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);

  for (const [name, value] of Object.entries(properties)) {
    const property =
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
    const type = formatSchemaType(property);
    const description =
      typeof property?.description === 'string' ? property.description : undefined;
    const enumValues = Array.isArray(property?.enum) ? ` enum(${property.enum.join(', ')})` : '';
    const prefix = ' '.repeat(indent);

    console.log(
      `${prefix}- ${name}${required.has(name) ? '' : '?'}: ${type}${enumValues}${description ? ` - ${description}` : ''}`
    );

    if (type === 'object' && property?.properties && typeof property.properties === 'object') {
      renderNestedSchemaProperties(property, indent + 2);
    }
  }
}

function getNestedObjectSchema(
  property: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!property) return undefined;

  if (
    property.type === 'object' &&
    property.properties &&
    typeof property.properties === 'object'
  ) {
    return property;
  }

  if (
    property.type === 'array' &&
    property.items &&
    typeof property.items === 'object' &&
    (property.items as Record<string, unknown>).type === 'object' &&
    (property.items as Record<string, unknown>).properties &&
    typeof (property.items as Record<string, unknown>).properties === 'object'
  ) {
    return property.items as Record<string, unknown>;
  }

  return undefined;
}

export function renderSchemaProperties(
  schema: Record<string, unknown> | undefined,
  emptyLabel: string
): void {
  const properties =
    schema?.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, unknown>)
      : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const names = Object.keys(properties);

  if (names.length === 0) {
    console.log(`  (no ${emptyLabel})`);
    return;
  }

  for (const name of names) {
    const property = properties[name] as Record<string, unknown> | undefined;
    const type = formatSchemaType(property);
    const description =
      typeof property?.description === 'string' ? property.description : undefined;
    const enumValues = Array.isArray(property?.enum) ? ` enum(${property.enum.join(', ')})` : '';

    const nestedObjectSchema = getNestedObjectSchema(property);
    if (nestedObjectSchema) {
      console.log(
        `  - ${name}${required.has(name) ? '' : '?'}: ${type}${description ? ` - ${description}` : ''}`
      );
      renderNestedSchemaProperties(nestedObjectSchema, 4);
      continue;
    }

    console.log(
      `  - ${name}${required.has(name) ? '' : '?'}: ${type}${enumValues}${description ? ` - ${description}` : ''}`
    );
  }
}

export function renderToolSchema(tool: Tool): void {
  renderSchemaProperties(tool.inputSchema as Record<string, unknown>, 'input parameters');
}
