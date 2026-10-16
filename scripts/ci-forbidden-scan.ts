import fs from 'node:fs';
import path from 'node:path';

/**
 * Opus Project Plan §10 — Global Forbidden Pattern CI Scanner
 * Rejects any fake baseline data, hardcoded online statuses, silent error swallowing
 * (including comment-only catch blocks, .catch(() => ...), and DEBUG_DB conditional catches),
 * Math.random() IDs, fake publish_time timestamps, synthetic company seeds,
 * hardcoded ISO/YYYY-MM-DD timestamps in server/content, or hardcoded stock codes in src/.
 */

const SCAN_ROOTS = ['server', 'src'];

interface Rule {
  id: string;
  description: string;
  regex: RegExp;
  scope?: 'all' | 'server_only' | 'server_content_only' | 'src_only';
}

const FORBIDDEN_RULES: Rule[] = [
  {
    id: 'NO_CURATED_BASELINE',
    description: 'Forbidden hardcoded fake baseline events (curated_baseline / CURATED_BASELINE_EVENTS)',
    regex: /\b(curated_baseline|CURATED_BASELINE_EVENTS)\b/,
  },
  {
    id: 'NO_FAKE_COMPANY_SEEDS',
    description: 'Forbidden hardcoded company seed tables or synthetic placeholder companies',
    regex: /\bCORE_STOCK_SEEDS\b|沪市标的企业|深市成长企业/,
  },
  {
    id: 'NO_MATH_RANDOM_ID',
    description: 'Forbidden Math.random() for IDs or data generation',
    regex: /Math\.random\s*\(/,
  },
  {
    id: 'NO_HARDCODED_ONLINE_STATUS',
    description: 'Forbidden hardcoded status: "online" literal or fake local_in_memory_pit_gate',
    regex: /status\s*:\s*['"]online['"]|local_in_memory_pit_gate/,
    scope: 'server_only',
  },
  {
    id: 'NO_SILENT_CATCH_EMPTY_ARRAY',
    description: 'Forbidden silent error swallowing (catch {} or catch { return [] })',
    regex: /catch\s*(?:\([^)]*\))?\s*\{\s*(?:return\s*\[\s*\]\s*;?\s*)?\}/,
  },
  {
    id: 'NO_SILENT_CATCH_COMMENT_ONLY',
    description: 'Forbidden comment-only silent catch blocks in server/content active modules',
    regex: /catch\s*(?:\([^)]*\))?\s*\{\s*(?:(?:\/\/[^\n]*\n|\s|\/\*[\s\S]*?\*\/)+)?\}/,
    scope: 'server_content_only',
  },
  {
    id: 'NO_PROMISE_SILENT_CATCH',
    description: 'Forbidden Promise .catch(() => ...) silent error swallowing in server/content active modules',
    regex: /\.catch\s*\(\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>\s*(?:\(|\[|null|undefined|false|true|''|""|\{\s*\})/,
    scope: 'server_content_only',
  },
  {
    id: 'NO_DEBUG_DB_SILENT_GATING',
    description: 'Forbidden process.env.DEBUG_DB conditional error logging in server/content active modules',
    regex: /process\.env\.DEBUG_DB/,
    scope: 'server_content_only',
  },
  {
    id: 'NO_HARDCODED_DATE_OR_TIMESTAMP_IN_CONTENT',
    description: 'Forbidden hardcoded YYYY-MM-DD or ISO timestamps in server/content runtime logic',
    regex: /['"`]202[0-9]-\d{2}-\d{2}(?:[T\s][^'"`]*)?['"`]/,
    scope: 'server_content_only',
  },
  {
    id: 'NO_DEFAULT_CHAIN_FALLBACK',
    description: 'Forbidden default chain fallback (CHAIN_ARCHETYPES[0])',
    regex: /CHAIN_ARCHETYPES\s*\[\s*0\s*\]/,
  },
  {
    id: 'NO_FAKE_PUBLISH_TIME',
    description: 'Forbidden assigning new Date() / Date.now() to published_at or publish_time',
    regex: /(?:published_at|publish_time)\s*:\s*[^,\n}]*new\s+Date\s*\(\s*(?:Date\.now\s*\(\s*\))?/,
  },
  {
    id: 'NO_HARDCODED_STOCK_CODES_IN_SRC',
    description: 'Forbidden hardcoded stock codes or QUICK_STOCK_PILLS in src/',
    regex: /\bQUICK_STOCK_PILLS\b|\b\d{6}\.(SZ|SH|BJ)\b/,
    scope: 'src_only',
  },
];

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

const READONLY_LEGACY_FILES = new Set([
  'server/content/editorial-api.ts',
  'server/content/editorial-worker.ts',
]);

const violations: string[] = [];
const rootDir = process.cwd();

for (const folder of SCAN_ROOTS) {
  const files = walkFiles(path.join(rootDir, folder));
  for (const file of files) {
    const rel = path.relative(rootDir, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf8');
    for (const rule of FORBIDDEN_RULES) {
      if (rule.scope === 'server_only' && !rel.startsWith('server/')) continue;
      if (rule.scope === 'server_content_only' && (!rel.startsWith('server/content/') || READONLY_LEGACY_FILES.has(rel))) continue;
      if (rule.scope === 'src_only' && !rel.startsWith('src/')) continue;
      const match = rule.regex.exec(content);
      if (match) {
        const line = content.slice(0, match.index).split('\n').length;
        violations.push(`[${rule.id}] ${rel}:${line} — ${rule.description} (matched: ${JSON.stringify(match[0])})`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('❌ CI Forbidden Pattern Scan FAILED:');
  for (const v of violations) {
    console.error('  -', v);
  }
  process.exit(1);
} else {
  console.log('✅ CI Forbidden Pattern Scan PASSED (0 violations)');
}
