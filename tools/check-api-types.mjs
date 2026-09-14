#!/usr/bin/env node
/**
 * Guard against `types/arrival.d.ts` drifting from the real runtime API.
 *
 * The surface is read from the client source by `api-surface.mjs` — there is no
 * list maintained here. This only compares that surface against the members
 * declared at the top level of `declare namespace ArrivalSpace`, and fails if
 * either side has something the other does not.
 *
 * Vibes are largely written by an AI agent reading these types, so a missing
 * declaration is not cosmetic — it tells the agent a real function does not
 * exist, and a stale one invites a call that throws at runtime.
 *
 *   node tools/check-api-types.mjs [path/to/arrival-api.js]
 *
 * Defaults to the sibling checkout at ../client_git (private repo), so this is a
 * local pre-publish check rather than a CI step for this public repo.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readApiSurface, DEFAULT_RUNTIME } from "./api-surface.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DTS = path.join(HERE, "../types/arrival.d.ts");

let surface;
try {
    surface = readApiSurface(process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_RUNTIME);
} catch (err) {
    console.error(err.message);
    process.exit(2);
}

// ── members declared at the top level of the d.ts namespace ────────────────
const dts = fs.readFileSync(DTS, "utf8").split("\n");
const nsStart = dts.findIndex((l) => l.includes("declare namespace ArrivalSpace"));
if (nsStart === -1) throw new Error("could not find `declare namespace ArrivalSpace` in the d.ts");

let depth = 0;
const declared = new Set();
for (let i = nsStart; i < dts.length; i++) {
    for (const ch of dts[i]) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
    }
    // exactly 4 spaces = top level of the namespace; deeper = a nested namespace's members
    const m = dts[i].match(/^ {4}(?:export\s+)?(?:function|const|let|var|namespace)\s+([A-Za-z_$][\w$]*)/);
    if (m) declared.add(m[1]);
    if (depth === 0 && i > nsStart) break;
}

// `debug` is attached at runtime only on localhost, so it is never in the literal.
const RUNTIME_CONDITIONAL = new Set(["debug"]);

const missing = surface.world.filter((k) => !declared.has(k));
const stale = [...declared].filter((k) => !surface.world.includes(k) && !RUNTIME_CONDITIONAL.has(k));

console.log(`runtime : ${surface.world.length} members  (${path.relative(process.cwd(), surface.source)})`);
console.log(`d.ts    : ${declared.size} declared    (types/arrival.d.ts)`);

if (missing.length) {
    console.error(`\n✗ ${missing.length} runtime member(s) NOT declared in types/arrival.d.ts:`);
    for (const n of missing) console.error(`    ArrivalSpace.${n}`);
    console.error("  An agent reading the types will be told these do not exist. Declare them.");
}
if (stale.length) {
    console.error(`\n✗ ${stale.length} declared member(s) NOT on the runtime object:`);
    for (const n of stale) console.error(`    ArrivalSpace.${n}`);
    console.error("  These invite calls that throw at runtime. Remove or fix them.");
}

if (missing.length || stale.length) process.exit(1);
console.log("\n✓ types/arrival.d.ts matches the runtime ArrivalSpace surface");
