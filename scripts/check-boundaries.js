import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const IGNORE_DIRS = new Set(['node_modules', '.git', 'coverage', '.tmp', 'dist', 'build']);

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
};

const rel = (f) => relative(ROOT, f).replace(/\\/g, '/');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const files = walk(ROOT);
const jsFiles = files.filter((f) => f.endsWith('.js'));
const violations = [];
const report = (rule, file, msg) => violations.push({ rule, file: rel(file), msg });

// Rule: no-typescript
for (const f of files) {
  const ext = extname(f);
  if (ext === '.ts' || ext === '.tsx' || f.endsWith('.d.ts')) {
    report('no-typescript', f, 'TypeScript source not allowed');
  }
  if (basename(f) === 'tsconfig.json') {
    report('no-typescript', f, 'tsconfig.json not allowed');
  }
}

// Rule: no-todos
const TODO_PATTERNS = [
  { re: /\/\/\s*TODO\b/i, msg: 'todo marker comment' },
  { re: /\/\/\s*FIXME\b/i, msg: 'fixme marker comment' },
  { re: /\b(it|test|describe)\.(skip|todo)\s*\(/, msg: 'skipped or todo test' },
  { re: /throw\s+new\s+Error\s*\(\s*['"`]not\s+implemented/i, msg: 'unimplemented stub throw' }
];
for (const f of jsFiles) {
  const src = readFileSync(f, 'utf8');
  for (const p of TODO_PATTERNS) {
    if (p.re.test(src)) {
      report('no-todos', f, p.msg);
      break;
    }
  }
}

// Rule: no-class (allowed only in core/errors.js — AppError extends Error)
const CLASS_RE = /\bclass\s+[A-Z]\w*/;
for (const f of jsFiles) {
  if (rel(f) === 'core/errors.js') continue;
  if (CLASS_RE.test(stripComments(readFileSync(f, 'utf8')))) {
    report('no-class', f, 'class declaration outside core/errors.js');
  }
}

// Rule: no-process-env-outside-config — applies to backend rail code only.
// UI workspaces (ui/**) are Vite build targets, not rail modules.
for (const f of jsFiles) {
  if (rel(f) === 'core/config.js') continue;
  if (rel(f).startsWith('ui/')) continue;
  if (/\bprocess\.env\b/.test(stripComments(readFileSync(f, 'utf8')))) {
    report('no-process-env-outside-config', f, 'environment variable reference');
  }
}

// Rule: no-cross-module-internals
const moduleOf = (absPath) => {
  const r = rel(absPath);
  const m = /^modules\/([^/]+)\//.exec(r);
  return m ? m[1] : null;
};
const IMPORT_RE = /(?:from|import)\s+['"]([^'"]+)['"]/g;
for (const f of jsFiles) {
  const fileMod = moduleOf(f);
  if (!fileMod) continue;
  const src = readFileSync(f, 'utf8');
  let m;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(f), spec);
    const targetMod = moduleOf(target);
    if (targetMod && targetMod !== fileMod && basename(target) !== 'index.js') {
      report(
        'no-cross-module-internals',
        f,
        `cross-module import not via index.js: ${spec}`
      );
    }
  }
}

// Rule: no-sql-outside-model — applies to modules/<n>/{service,controller}.js
const SQL_RE =
  /\b(SELECT\s+\*|SELECT\s+[a-z_][\w]*|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i;
for (const f of jsFiles) {
  if (!/^modules\/[^/]+\/(service|controller)\.js$/.test(rel(f))) continue;
  if (SQL_RE.test(stripComments(readFileSync(f, 'utf8')))) {
    report('no-sql-outside-model', f, 'SQL keyword in service.js or controller.js');
  }
}

// Rule: no-res-methods-in-controller
const RES_RE = /\bres\.(json|status|send|cookie|clearCookie)\s*\(/;
for (const f of jsFiles) {
  if (!/^modules\/[^/]+\/controller\.js$/.test(rel(f))) continue;
  if (RES_RE.test(stripComments(readFileSync(f, 'utf8')))) {
    report('no-res-methods-in-controller', f, 'res.<method>(...) call');
  }
}

// Rule: no-joi-in-controller
const JOI_RE = /(?:from|import)\s+['"]joi['"]/;
for (const f of jsFiles) {
  if (!/^modules\/[^/]+\/controller\.js$/.test(rel(f))) continue;
  if (JOI_RE.test(readFileSync(f, 'utf8'))) {
    report('no-joi-in-controller', f, 'joi imported in controller.js');
  }
}

if (violations.length === 0) {
  console.log('check-boundaries: clean');
  process.exit(0);
}

console.error(`check-boundaries: ${violations.length} violation(s)`);
for (const v of violations) {
  console.error(`  [${v.rule}] ${v.file}: ${v.msg}`);
}
process.exit(1);
