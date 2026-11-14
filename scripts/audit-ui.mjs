#!/usr/bin/env node
/**
 * Style drift, caught where it starts.
 *
 * The console has one type scale, one corner scale, three breakpoints and one palette, all of them
 * in `src/admin/styles/theme.css`. This walks every stylesheet and reports anything that spells out
 * its own value instead of naming a token — which is how 65 font sizes and 31 radii got here the
 * first time: nothing wrong with any single one of them, and nobody was counting.
 *
 *   node scripts/audit-ui.mjs          report, always exits 0
 *   node scripts/audit-ui.mjs strict   exits 1 if anything is found (what CI runs)
 *
 * Two escape hatches, both written on the offending line so the exception is visible in review:
 *   `/* brand *\/`     a colour that belongs to something else (a provider's logo, a remote's keys)
 *   `/* audit-ok: … *\/`  anything else, with the reason after the colon
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(rootDir, 'src', 'admin');
const strict = process.argv[2] === 'strict';

const BREAKPOINTS = new Set([640, 900, 1200]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(css|tsx?)$/.test(name)) out.push(path);
  }
  return out;
}

const files = walk(srcDir);
const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));

// Every custom property that exists: declared in CSS, or set from script (`setProperty('--mx', …)`).
const defined = new Set();
for (const [file, text] of sources) {
  const pattern = file.endsWith('.css') ? /(--[A-Za-z0-9-]+)\s*:/g : /['"`](--[A-Za-z0-9-]+)['"`]/g;
  for (const match of text.matchAll(pattern)) defined.add(match[1]);
}

const findings = new Map();
function report(rule, file, lineNo, line) {
  if (!findings.has(rule)) findings.set(rule, []);
  findings.get(rule).push(`  ${relative(rootDir, file)}:${lineNo}  ${line.trim().slice(0, 110)}`);
}

const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[0-9]/;
const stripUrls = (line) => line.replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/g, 'url()');
const stripComments = (line) => line.replace(/\/\*.*?\*\//g, '');

for (const [file, text] of sources) {
  const lines = text.split('\n');

  if (!file.endsWith('.css')) {
    lines.forEach((line, index) => {
      if (/\b(fontSize|borderRadius):\s*['"]?[0-9]/.test(line)) {
        report('inline style with a raw size (use a token: var(--fs-*), var(--radius-*))', file, index + 1, line);
      }
    });
    continue;
  }

  const isTheme = file.endsWith(join('styles', 'theme.css'));
  let depth = 0;
  let inLightRule = false;
  let inComment = false;

  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const exempt = /\/\*\s*(brand|audit-ok)\b/.test(rawLine);

    // Drop comment text so prose that mentions `#4ADE80` or `10px` is not read as a declaration.
    let line = rawLine;
    if (inComment) {
      const end = line.indexOf('*/');
      if (end === -1) return;
      line = line.slice(end + 2);
      inComment = false;
    }
    line = stripComments(line);
    const open = line.indexOf('/*');
    if (open !== -1) {
      line = line.slice(0, open);
      inComment = true;
    }

    if (depth === 0 && /data-theme='light'/.test(line)) inLightRule = true;
    const isTokenDef = /^\s*--[A-Za-z0-9-]+\s*:/.test(line);

    if (!exempt) {
      const fontSize = /font-size:\s*([^;]+);/.exec(line);
      if (fontSize && !isTokenDef && !/^(var\(--fs-[a-z0-9]+\)|inherit|[0-9.]+em|0)$/.test(fontSize[1].trim())) {
        report('font-size off the type scale (use var(--fs-*))', file, lineNo, rawLine);
      }

      const radius = /border(?:-[a-z]+)*-radius:\s*([^;]+);/.exec(line);
      if (radius && !isTokenDef) {
        const parts = radius[1].trim().split(/\s+/);
        if (!parts.every((part) => /^(var\(--radius-[a-z]+\)|0|50%|inherit)$/.test(part))) {
          report('border-radius off the corner scale (use var(--radius-*))', file, lineNo, rawLine);
        }
      }

      for (const query of line.matchAll(/\((max|min)-width:\s*(\d+)px\)/g)) {
        const px = Number(query[2]) - (query[1] === 'min' ? 1 : 0);
        if (line.includes('@media') && !BREAKPOINTS.has(px)) {
          report('breakpoint off the grid (640 / 900 / 1200; min-width is one above)', file, lineNo, rawLine);
        }
      }

      // The theme is where colours are spelled out: its token definitions, and the light theme's
      // own overrides. Everywhere else a colour is a token, or a `color-mix()` of one.
      const colourAllowed = isTheme && (isTokenDef || inLightRule);
      if (!colourAllowed && RAW_COLOUR.test(stripUrls(line))) {
        report('raw colour (use a token, or color-mix(in srgb, var(--token) N%, transparent))', file, lineNo, rawLine);
      }
    }

    for (const use of line.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)) {
      if (!defined.has(use[1])) report('unknown token', file, lineNo, rawLine);
    }

    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth === 0 && line.includes('}')) inLightRule = false;
  });
}

let total = 0;
for (const [rule, lines] of findings) {
  total += lines.length;
  console.log(`\n${rule} — ${lines.length}`);
  console.log(lines.join('\n'));
}

if (total === 0) {
  console.log('UI audit: OK — every size, corner, breakpoint and colour comes from the theme.');
} else {
  console.log(`\nUI audit: ${total} finding${total === 1 ? '' : 's'}${strict ? '' : ' (report mode, not failing)'}.`);
  if (strict) process.exit(1);
}
