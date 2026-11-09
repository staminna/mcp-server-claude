#!/usr/bin/env node
// Writes the server's tools/list payload to a JSON file for the TDQS gate
// (`npm run tdqs`). Reads the built output, so run `npm run build` first — the
// `pretdqs` script does that for you.
//
//   node scripts/dump-tools.mjs [outfile]   # default: .tdqs-tools.json
import { writeFileSync } from 'node:fs';
import { TOOL_DEFINITIONS } from '../dist/server.js';

const out = process.argv[2] ?? '.tdqs-tools.json';
writeFileSync(out, JSON.stringify({ tools: TOOL_DEFINITIONS }, null, 2));
console.log(`${TOOL_DEFINITIONS.length} tool definitions written to ${out}`);
