/** Read-only coverage check for #192/#193; no secrets, server or database needed. */
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
async function routes(dir) {
    const result = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const name = path.join(dir, entry.name);
        if (entry.isDirectory()) result.push(...await routes(name));
        else if (entry.name === 'route.js') {
            const source = await readFile(name, 'utf8');
            const route = `/${path.relative(path.join(root, 'app'), path.dirname(name)).split(path.sep).join('/')}`;
            const exports = [...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/g)].map(match => match[1]);
            for (const match of source.matchAll(/export\s*\{([^}]+)\}\s*from/g)) {
                exports.push(...match[1].split(',').map(value => value.trim()).filter(value => methods.has(value)));
            }
            for (const method of new Set(exports)) result.push({ route, method });
        }
    }
    return result;
}
const actual = await routes(path.join(root, 'app/api'));
const errors = [];
for (const doc of ['docs/API_VALIDATION.md', 'docs/security/RBAC_SPEC.md']) {
    const source = await readFile(path.join(root, doc), 'utf8');
    for (const { route, method } of actual) {
        const present = doc.endsWith('RBAC_SPEC.md')
            ? source.includes(`| ${method} | [${route}]`)
            : source.includes(`${method} ${route}`);
        if (!present) errors.push(`${doc}: missing ${method} ${route}`);
    }
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^(?:https?:|mailto:|#)/.test(target)) continue;
        try { await access(path.resolve(root, path.dirname(doc), target.split('#')[0])); }
        catch { errors.push(`${doc}: broken local link ${target}`); }
    }
}
const api = yaml.load(await readFile(path.join(root, 'docs/api/openapi.yaml'), 'utf8'));
const documented = [];
for (const [route, item] of Object.entries(api.paths)) {
    for (const method of Object.keys(item)) if (methods.has(method.toUpperCase())) {
        documented.push(`${method.toUpperCase()} /api${route}`);
    }
}
const normalize = route => route.replace(/\[([^\]]+)\]/g, '{$1}');
const live = actual.map(({ route, method }) => `${method} ${normalize(route)}`);
const missing = live.filter(key => !documented.includes(key)).sort();
const planned = documented.filter(key => !live.includes(key)).sort();
console.log(JSON.stringify({ implementedOperations: actual.length, documentsChecked: 2,
    coverageErrors: errors, openApiMissingLiveOperations: missing, openApiWithoutHandlers: planned }, null, 2));
if (errors.length) process.exitCode = 1;
