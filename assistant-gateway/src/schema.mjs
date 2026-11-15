// Minimal JSON Schema (draft 2020-12 subset) validator, dependency free.
// Supports exactly the keywords used by shared/assistant-contract/*.schema.json:
// $ref (local #/$defs/...), type (string or array), enum, const, required, properties,
// additionalProperties (boolean or schema), items, minItems, maxItems, minLength,
// maxLength, minimum, maximum, pattern. Unknown keywords are ignored on purpose, but the
// contract tests assert the shipped schemas only use keywords listed here.

export const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', '$ref', '$defs', 'title', 'description', 'type', 'enum', 'const', 'required',
  'properties', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength',
  'minimum', 'maximum', 'pattern',
]);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // string, number, boolean, object
}

function matchesType(v, t) {
  if (t === 'integer') return typeof v === 'number' && Number.isInteger(v);
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeOf(v) === t;
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported $ref ${ref}`);
  // Own properties only: "#/$defs/constructor" must not resolve to an Object.prototype member.
  return ref.slice(2).split('/').reduce((n, k) => (n !== null && typeof n === 'object' && Object.hasOwn(n, k) ? n[k] : undefined), root);
}

export function validate(schema, value, root = schema, path = '', errors = []) {
  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    if (!target) throw new Error(`Unresolvable $ref ${schema.$ref}`);
    validate(target, value, root, path, errors);
    return errors;
  }
  const at = path || '(root)';
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${at}: expected ${types.join(' or ')}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${at}: does not match pattern ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => validate(schema.items, item, root, `${path}[${i}]`, errors));
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path ? path + '.' : ''}${key}: required`);
    }
    const props = schema.properties ?? {};
    for (const [key, v] of Object.entries(value)) {
      const p = path ? `${path}.${key}` : key;
      // Own properties only: `in` would treat "constructor", "toString" or "__proto__" as declared.
      if (Object.hasOwn(props, key)) validate(props[key], v, root, p, errors);
      else if (schema.additionalProperties === false) errors.push(`${p}: unknown property`);
      else if (typeof schema.additionalProperties === 'object') validate(schema.additionalProperties, v, root, p, errors);
    }
  }
  return errors;
}

/** Collect every keyword used in a schema (for the self-check test). */
export function usedKeywords(schema, acc = new Set(), inProperties = false) {
  if (Array.isArray(schema)) { schema.forEach((s) => usedKeywords(s, acc)); return acc; }
  if (schema && typeof schema === 'object') {
    for (const [k, v] of Object.entries(schema)) {
      if (!inProperties) acc.add(k);
      if (k === 'properties' || k === '$defs') for (const sub of Object.values(v)) usedKeywords(sub, acc);
      else if (k === 'items' || k === 'additionalProperties') usedKeywords(v, acc);
    }
  }
  return acc;
}
