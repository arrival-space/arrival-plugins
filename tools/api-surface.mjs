/**
 * The plugin API surface, read from the client source. Single source of truth.
 *
 * Nothing here is a hand-maintained list. Every name and every deprecation
 * replacement is read out of `scripts/arrival-api.js`, where it sits next to the
 * code it describes:
 *
 *   - world surface   : the keys of the `window.ArrivalSpace = { ... }` literal
 *   - instance surface: the members of `class ArrivalScript`
 *   - deprecations    : the `@deprecated ... {@link ArrivalSpace.x}` tag on the
 *                       member itself — `{@link}` is standard TSDoc, so the same
 *                       tag drives the editor strike-through, the generated
 *                       .d.ts, and the replacement a tool suggests.
 *
 * Add a member or change a deprecation target and this follows automatically;
 * there is no second place to update.
 *
 * Used by `check-api-types.mjs`, and by `emit-api-surface.mjs` to produce the
 * JSON the space_code_agent reads (it lives in another repo and cannot import
 * from the client checkout).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RUNTIME = path.resolve(HERE, "../../client_git/scripts/arrival-api.js");

/** Slice out the brace-balanced block starting at `startIdx`. */
function braceBlock(lines, startIdx) {
    let depth = 0;
    for (let i = startIdx; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === "{") depth++;
            else if (ch === "}") depth--;
        }
        if (depth === 0 && i > startIdx) return lines.slice(startIdx, i + 1);
    }
    throw new Error(`unbalanced block at line ${startIdx + 1}`);
}

/** Collect the JSDoc block immediately above `idx`, as one flattened string. */
function jsdocAbove(lines, idx) {
    if (!/^\s*\*\//.test(lines[idx - 1] ?? "")) return "";
    let j = idx - 1;
    while (j >= 0 && !/^\s*\/\*\*/.test(lines[j])) j--;
    return lines
        .slice(j, idx)
        .map((l) => l.replace(/^\s*\/?\*+\/?\s?/, ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

export function readApiSurface(runtimePath = DEFAULT_RUNTIME) {
    if (!fs.existsSync(runtimePath)) {
        throw new Error(
            `Cannot find the client runtime source at:\n  ${runtimePath}\n` +
                `Pass a path explicitly, e.g. ../client_git/scripts/arrival-api.js`,
        );
    }
    const lines = fs.readFileSync(runtimePath, "utf8").split("\n");

    // ── world surface ──────────────────────────────────────────────────────
    const litStart = lines.findIndex((l) => l.includes("window.ArrivalSpace = {"));
    if (litStart === -1) throw new Error("could not find `window.ArrivalSpace = {`");
    const world = [];
    for (const l of braceBlock(lines, litStart)) {
        const m = l.match(/^ {8}([A-Za-z_$][\w$]*)\s*(,|:)/);
        if (m && !m[1].startsWith("_") && !world.includes(m[1])) world.push(m[1]);
    }

    // ── instance surface + deprecations ────────────────────────────────────
    const clsStart = lines.findIndex((l) => /^class ArrivalScript extends/.test(l));
    if (clsStart === -1) throw new Error("could not find `class ArrivalScript`");
    const cls = braceBlock(lines, clsStart);

    const instance = [];
    const deprecated = {};
    for (let i = 0; i < cls.length; i++) {
        const m = cls[i].match(/^    (?:get |set |async )?([A-Za-z_$][\w$]*)\s*[({]/);
        if (!m) continue;
        const name = m[1];
        if (name.startsWith("_")) continue;
        if (!instance.includes(name)) instance.push(name);

        const doc = jsdocAbove(cls, i);
        if (!/@deprecated/.test(doc)) continue;
        const advice = doc.slice(doc.indexOf("@deprecated") + "@deprecated".length).trim();
        const link = advice.match(/\{@link ArrivalSpace\.([A-Za-z_$][\w$]*)\}/);
        deprecated[name] = { replacement: link ? link[1] : null, advice };
    }

    return { world, instance, deprecated, source: runtimePath };
}
