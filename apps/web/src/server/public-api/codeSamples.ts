/**
 * Request samples for the reference, generated from the same declaration the
 * rest of the document is: method, path and request-body schema. Nothing here
 * is typed per endpoint, so a new route gets samples the day it is declared.
 */

/** Where the samples point. The document's own `servers` is relative; a pasted sample cannot be. */
export const SAMPLE_ORIGIN = "https://caesura.today/api";

const TOKEN_PLACEHOLDER = "tc_YOUR_TOKEN";

export interface CodeSample {
  lang: string;
  label: string;
  source: string;
}

type Schema = Record<string, unknown>;

/**
 * A plausible value for `schema`: its own `example`/`default`/first enum member
 * if it has one, else a value of its type. Only required properties are
 * written, so the sample is the smallest request that is valid.
 */
export function exampleOf(schema: Schema | undefined, depth = 0): unknown {
  if (schema === undefined || depth > 6) return null;
  if ("example" in schema) return schema.example;
  if ("default" in schema) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  const variants = (schema.oneOf ?? schema.anyOf) as Schema[] | undefined;
  if (variants !== undefined && variants.length > 0) return exampleOf(variants[0], depth + 1);
  if (Array.isArray(schema.allOf)) {
    return Object.assign({}, ...(schema.allOf as Schema[]).map((s) => exampleOf(s, depth + 1)));
  }
  switch (schema.type) {
    case "string":
      return schema.format === "uuid" ? "00000000-0000-4000-8000-000000000000" : "string";
    case "integer":
    case "number":
      return typeof schema.minimum === "number" ? schema.minimum : 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object": {
      const properties = (schema.properties ?? {}) as Record<string, Schema>;
      const required = (schema.required ?? []) as string[];
      return Object.fromEntries(required.filter((k) => k in properties).map((k) => [k, exampleOf(properties[k], depth + 1)]));
    }
    default:
      return null;
  }
}

/** The three samples for one operation. `url` keeps its `{param}` segments. */
export function codeSamplesFor(op: { method: string; url: string; body?: Schema }): CodeSample[] {
  const method = op.method.toUpperCase();
  const href = `${SAMPLE_ORIGIN}${op.url}`;
  const json = op.body === undefined ? undefined : JSON.stringify(exampleOf(op.body), null, 2);

  const curl = [
    `curl -X ${method} '${href}'`,
    `  -H 'Authorization: Bearer ${TOKEN_PLACEHOLDER}'`,
    ...(json === undefined ? [] : [`  -H 'Content-Type: application/json'`, `  -d '${json.replaceAll("'", "'\\''")}'`]),
  ].join(" \\\n");

  const js = [
    `const response = await fetch(${JSON.stringify(href)}, {`,
    `  method: ${JSON.stringify(method)},`,
    `  headers: {`,
    `    Authorization: "Bearer ${TOKEN_PLACEHOLDER}",`,
    ...(json === undefined ? [] : [`    "Content-Type": "application/json",`]),
    `  },`,
    ...(json === undefined ? [] : [`  body: JSON.stringify(${json.replaceAll("\n", "\n  ")}),`]),
    `});`,
    `const data = await response.json();`,
  ].join("\n");

  const py = [
    `import requests`,
    ``,
    `response = requests.request(`,
    `    ${JSON.stringify(method)},`,
    `    ${JSON.stringify(href)},`,
    `    headers={"Authorization": "Bearer ${TOKEN_PLACEHOLDER}"},`,
    ...(json === undefined ? [] : [`    json=${pythonLiteral(JSON.parse(json))},`]),
    `)`,
    `data = response.json()`,
  ].join("\n");

  return [
    { lang: "Shell", label: "curl", source: curl },
    { lang: "JavaScript", label: "JavaScript (fetch)", source: js },
    { lang: "Python", label: "Python (requests)", source: py },
  ];
}

/** JSON as a Python literal: the three differences are `null`, `true` and `false`. */
function pythonLiteral(value: unknown): string {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${JSON.stringify(k)}: ${pythonLiteral(v)}`)
      .join(", ")}}`;
  }
  return JSON.stringify(value);
}
