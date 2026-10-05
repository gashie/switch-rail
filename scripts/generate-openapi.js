// Walks modules/*/schema.js + modules/*/routes.js and emits an OpenAPI
// 3.1 document at docs/openapi.json. The shape isn't a full description —
// it's a living index of every route the rail exposes, with request body
// / query schemas converted from Joi via joi-to-openapi-style conversion
// inlined here (no extra dep).
//
// This is good enough for a developer portal landing page. Anything that
// needs full schema fidelity should regenerate from this script.

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Joi from 'joi';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MODULES_DIR = join(ROOT, 'modules');
const OUT_DIR = join(ROOT, 'docs');
const OUT_FILE = join(OUT_DIR, 'openapi.json');

const joiToSchema = (joi) => {
  if (!joi || typeof joi.describe !== 'function') return { type: 'object' };
  const desc = joi.describe();
  return convertDesc(desc);
};

const convertDesc = (desc) => {
  if (!desc) return {};
  switch (desc.type) {
    case 'string': {
      const out = { type: 'string' };
      if (desc.flags?.format === 'uuid' || desc.metas?.some((m) => m?.format === 'uuid')) out.format = 'uuid';
      if (desc.rules?.some((r) => r.name === 'isoDate')) out.format = 'date-time';
      if (desc.allow?.includes(null)) out.nullable = true;
      if (Array.isArray(desc.valids) && desc.valids.length > 0) out.enum = desc.valids.filter((v) => v !== null);
      return out;
    }
    case 'number': return { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    case 'array': return { type: 'array', items: desc.items?.[0] ? convertDesc(desc.items[0]) : { type: 'object' } };
    case 'alternatives':
      return { oneOf: (desc.matches || []).map((m) => convertDesc(m.schema || m)) };
    case 'object': {
      const out = { type: 'object', properties: {}, required: [] };
      const keys = desc.keys || {};
      for (const [k, v] of Object.entries(keys)) {
        out.properties[k] = convertDesc(v);
        if (v?.flags?.presence === 'required') out.required.push(k);
      }
      if (out.required.length === 0) delete out.required;
      return out;
    }
    default:
      return {};
  }
};

const ROUTE_RE = /router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
const VALIDATE_BODY_RE = /validateBody\s*\(\s*([A-Za-z0-9_$]+)/g;
const VALIDATE_QUERY_RE = /validateQuery\s*\(\s*([A-Za-z0-9_$]+)/g;

const moduleNamesUnderRoot = (root) =>
  readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

const loadSchemas = async (modulePath) => {
  try {
    const url = pathToFileURL(join(modulePath, 'schema.js')).href;
    return await import(url);
  } catch {
    return {};
  }
};

const main = async () => {
  const modules = moduleNamesUnderRoot(MODULES_DIR).filter((m) => !m.startsWith('.'));
  const paths = {};
  for (const m of modules) {
    const moduleDir = join(MODULES_DIR, m);
    const routesFile = join(moduleDir, 'routes.js');
    let src;
    try { src = readFileSync(routesFile, 'utf8'); } catch { continue; }

    const schemas = await loadSchemas(moduleDir);

    // For each `router.METHOD('/<path>'...)`, extract the immediately
    // preceding validateBody / validateQuery binding (if any) by walking
    // the same call's arguments naively.
    const callRe = /router\.(get|post|put|delete|patch)\s*\(([\s\S]*?)\)\s*;/g;
    let match;
    while ((match = callRe.exec(src)) !== null) {
      const method = match[1];
      const inside = match[2];
      const pathMatch = /^\s*['"]([^'"]+)['"]/.exec(inside);
      if (!pathMatch) continue;
      const route = pathMatch[1];
      const fullPath = `/${m}${route === '/' ? '' : route}`;
      const queryName = (VALIDATE_QUERY_RE.exec(inside) || [])[1];
      VALIDATE_QUERY_RE.lastIndex = 0;
      const bodyName = (VALIDATE_BODY_RE.exec(inside) || [])[1];
      VALIDATE_BODY_RE.lastIndex = 0;

      const op = {
        tags: [m],
        summary: `${method.toUpperCase()} ${fullPath}`,
        responses: {
          '200': { description: 'OK envelope { ok: true, data: ... }' },
          '400': { description: 'Validation failure' },
          '500': { description: 'Internal error' }
        }
      };
      if (queryName && schemas[queryName] && Joi.isSchema(schemas[queryName])) {
        op.parameters = Object.entries(joiToSchema(schemas[queryName]).properties || {}).map(([k, schema]) => ({
          name: k, in: 'query', schema,
          required: (joiToSchema(schemas[queryName]).required || []).includes(k)
        }));
      }
      if (bodyName && schemas[bodyName] && Joi.isSchema(schemas[bodyName])) {
        op.requestBody = {
          required: true,
          content: { 'application/json': { schema: joiToSchema(schemas[bodyName]) } }
        };
      }
      // Reset regexes for the next iteration.
      ROUTE_RE.lastIndex = 0;

      if (!paths[fullPath]) paths[fullPath] = {};
      paths[fullPath][method] = op;
    }
  }

  const doc = {
    openapi: '3.1.0',
    info: {
      title: 'Sika Rail API',
      version: '0.10.0',
      description: 'Generated from modules/*/routes.js + schema.js. The Joi schemas are converted in-place and may not capture every constraint; refer to the source for authoritative shape.'
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local rail (monolith)' }
    ],
    paths
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(doc, null, 2));
  const opCount = Object.values(paths).reduce((n, byMethod) => n + Object.keys(byMethod).length, 0);
  console.log(`openapi: wrote ${OUT_FILE} (${Object.keys(paths).length} paths, ${opCount} operations)`);
};

main().catch((e) => { console.error(e); process.exit(1); });
