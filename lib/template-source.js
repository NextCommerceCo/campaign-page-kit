#!/usr/bin/env node

/**
 * Template sources — where `campaign-init` pulls starter templates from.
 *
 * One interface, three transports:
 *   - github : public HTTP fetch (raw.githubusercontent + codeload tarball) — the
 *              built-in default; no auth.
 *   - local  : read a directory already on disk.
 *   - git    : shallow SSH clone of a (private) repo using ambient keys.
 *
 * Every provider implements the same surface and callers never branch on type:
 *   readJson(repoRelPath)   -> object
 *   readText(repoRelPath)   -> string
 *   materialize(slug, dest) -> fileCount   (copies src/<slug>/ into dest)
 *   dispose()               -> void        (cleanup, e.g. a git temp clone)
 *
 * `type` is switched on in exactly one place: the SOURCE_TYPES registry.
 * The template copy flow is one shared primitive (copySubtree) that every
 * provider feeds; only "how a local root dir is obtained" differs per type.
 *
 * Deferred (registry stays open, none implemented here): authenticated
 * github/gitlab HTTP (token-env), and gh/glab CLI strategies.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile, execFileSync } = require('child_process');

// The default public source. This lives in CODE, never in
// _data/template-sources.json — existing projects have no such file and must
// keep working unchanged. The `public` key is reserved.
const BUILTIN_PUBLIC = {
    type: 'github',
    label: 'Public starter templates',
    repo: 'NextCommerceCo/campaign-cart-starter-templates',
    ref: 'main',
};

const SOURCES_FILE = ['_data', 'template-sources.json'];
const AI_CONTEXT_DOC_PATH = 'docs/campaign-page-kit-template-context.md';

const GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new';

function codedError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

// ---------------------------------------------------------------------------
// HTTP helpers (used by the github provider)
// ---------------------------------------------------------------------------

function fetchBuffer(url, redirects = 5) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                if (redirects <= 0) return reject(new Error('too many redirects'));
                return resolve(fetchBuffer(res.headers.location, redirects - 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

async function fetchJson(url) {
    const buf = await fetchBuffer(url);
    return JSON.parse(buf.toString('utf8'));
}

// ---------------------------------------------------------------------------
// Shared filesystem primitives
// ---------------------------------------------------------------------------

function countFiles(dir) {
    let n = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
        else n++;
    }
    return n;
}

// THE template copy flow. Every provider's materialize() ends here: given a
// local root directory (a clone, a working copy, or an extracted tarball),
// copy src/<slug>/ into destDir and report the file count.
function copySubtree(rootDir, slug, destDir) {
    const sourceDir = path.join(rootDir, 'src', slug);
    if (!fs.existsSync(sourceDir)) {
        throw codedError('UPSTREAM_FETCH_FAILED', `source has no src/${slug}/`);
    }
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    fs.cpSync(sourceDir, destDir, { recursive: true });
    return countFiles(destDir);
}

// Extract a single template's src/<slug>/ subtree from an upstream tarball
// using the system `tar`, then hand off to copySubtree.
function extractTemplate(tarball, slug, destDir) {
    const parent = path.dirname(destDir);
    fs.mkdirSync(parent, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(parent, '.cpk-extract-'));
    try {
        execFileSync('tar', ['-xz'], { input: tarball, cwd: tmpDir, stdio: ['pipe', 'ignore', 'pipe'] });
        const repoRoot = fs.readdirSync(tmpDir).find(d =>
            fs.statSync(path.join(tmpDir, d)).isDirectory()
        );
        if (!repoRoot) throw new Error('tarball had no top-level directory');
        return copySubtree(path.join(tmpDir, repoRoot), slug, destDir);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Catalog helper
// ---------------------------------------------------------------------------

// Filter + sort a templates.json manifest into the order the picker shows.
// Drops `hidden`, sorts by `priority` desc, name asc as tiebreak.
function selectableTemplates(manifest) {
    return (manifest && manifest.templates || [])
        .filter(t => !t.hidden)
        .sort((a, b) => {
            const dp = (b.priority || 0) - (a.priority || 0);
            return dp !== 0 ? dp : String(a.name || a.slug).localeCompare(String(b.name || b.slug));
        });
}

// ---------------------------------------------------------------------------
// Root acquisition (the only thing that differs between local and git)
// ---------------------------------------------------------------------------

// Resolve a `local` source's path to an existing directory. `~` is expanded;
// relative paths resolve against ctx.brandRoot (the project root).
function resolveLocalRoot(source, ctx) {
    let p = source.path || '';
    if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1));
    const base = (ctx && ctx.brandRoot) || process.cwd();
    const root = path.resolve(base, p);
    if (!fs.existsSync(root)) {
        throw codedError('UPSTREAM_FETCH_FAILED', `local source path not found: ${root}`);
    }
    return root;
}

// Shallow-clone a `git` source into a temp dir and return that dir.
// Omitting source.ref clones the remote's default branch (no --branch);
// a ref pins to that branch or tag. Async (non-blocking) so callers can show
// an animated spinner during the clone — a synchronous clone would freeze the
// event loop and the loader would never paint.
async function cloneToTemp(source, ctx) {
    const exec = (ctx && ctx.exec) || defaultGitExec;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpk-clone-'));
    const args = ['clone', '--depth', '1', '--single-branch'];
    if (source.ref) args.push('--branch', source.ref);
    args.push(source.url, tmp);
    try {
        await exec(args);
    } catch (err) {
        fs.rmSync(tmp, { recursive: true, force: true });
        if (err && err.code === 'ENOENT') {
            throw codedError('UPSTREAM_FETCH_FAILED', 'git is not installed or not on PATH');
        }
        const detail = (err && err.stderr && err.stderr.toString().trim()) || (err && err.message) || 'unknown error';
        throw codedError('UPSTREAM_FETCH_FAILED', `git clone failed: ${detail}`);
    }
    return tmp;
}

function defaultGitExec(args) {
    return new Promise((resolve, reject) => {
        execFile('git', args, {
            env: { ...process.env, GIT_SSH_COMMAND, GIT_TERMINAL_PROMPT: '0' },
        }, (err, _stdout, stderr) => {
            if (err) { err.stderr = stderr; reject(err); }
            else resolve();
        });
    });
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

// github: public HTTP. Reads are cheap per-file raw fetches; the tarball is
// downloaded only on materialize() so the picker never pulls a tarball just
// to list templates.
class PublicProvider {
    constructor(source, ctx) {
        this.source = source;
        this._fetchBuffer = (ctx && ctx.fetchBuffer) || fetchBuffer;
    }
    _rawUrl(rel) {
        return `https://raw.githubusercontent.com/${this.source.repo}/${this.source.ref}/${rel}`;
    }
    _tarballUrl() {
        return `https://codeload.github.com/${this.source.repo}/tar.gz/refs/heads/${this.source.ref}`;
    }
    async readJson(rel) {
        const buf = await this._fetchBuffer(this._rawUrl(rel));
        return JSON.parse(buf.toString('utf8'));
    }
    async readText(rel) {
        const buf = await this._fetchBuffer(this._rawUrl(rel));
        return buf.toString('utf8');
    }
    async materialize(slug, destDir) {
        const tarball = await this._fetchBuffer(this._tarballUrl());
        return extractTemplate(tarball, slug, destDir);
    }
    dispose() {}
}

// local + git: both read from a single local root dir. They differ only in how
// that root is acquired — the `acquire` thunk returns { root, cleanup }. The
// root is acquired once (git clones a single time) and reused for all reads,
// the copy, and validation; dispose() runs the cleanup.
class LocalRootProvider {
    constructor(acquire) {
        this._acquire = acquire;
        this._acquired = null;
    }
    // Acquire the root once (git clones a single time) and reuse it. Async
    // because a git clone is async — callers await all reads anyway.
    async _root() {
        if (!this._acquired) this._acquired = await this._acquire();
        return this._acquired.root;
    }
    // Read relative to the root, translating a missing file into a message that
    // names the requested path, not the internal temp/clone directory.
    async _read(rel) {
        const root = await this._root();
        try {
            return fs.readFileSync(path.join(root, rel), 'utf8');
        } catch (err) {
            if (err && err.code === 'ENOENT') {
                throw codedError('UPSTREAM_FETCH_FAILED', `${rel} not found in source`);
            }
            throw err;
        }
    }
    async readJson(rel) {
        return JSON.parse(await this._read(rel));
    }
    async readText(rel) {
        return this._read(rel);
    }
    async materialize(slug, destDir) {
        return copySubtree(await this._root(), slug, destDir);
    }
    dispose() {
        if (this._acquired) {
            try { this._acquired.cleanup(); } catch { /* best effort */ }
            this._acquired = null;
        }
    }
}

// The ONLY place source.type is branched.
const SOURCE_TYPES = {
    github: (source, ctx) => new PublicProvider(source, ctx),
    local:  (source, ctx) => new LocalRootProvider(() => ({
        root: resolveLocalRoot(source, ctx),
        cleanup: () => {},
    })),
    git:    (source, ctx) => new LocalRootProvider(async () => {
        const dir = await cloneToTemp(source, ctx);
        return { root: dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
    }),
};

function createProvider(source, ctx = {}) {
    const make = SOURCE_TYPES[source && source.type];
    if (!make) {
        throw codedError('INVALID_INPUT', `unknown source type "${source && source.type}"`);
    }
    return make(source, ctx);
}

// ---------------------------------------------------------------------------
// Source registry (loading, resolving, validating, mutating)
// ---------------------------------------------------------------------------

function sourcesFilePath(brandRoot) {
    return path.join(brandRoot || process.cwd(), ...SOURCES_FILE);
}

// Read the on-disk file's own sources (NOT merged with the built-in public).
// Used when adding/removing entries. Returns { sources: {} } when absent.
function readSourcesFile(brandRoot) {
    const file = sourcesFilePath(brandRoot);
    if (!fs.existsSync(file)) return { sources: {} };
    let doc;
    try {
        doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        throw codedError('INVALID_INPUT', `could not parse _data/template-sources.json: ${err.message}`);
    }
    if (!doc || typeof doc !== 'object' || (doc.sources && typeof doc.sources !== 'object')) {
        throw codedError('INVALID_INPUT', '_data/template-sources.json must be an object with a "sources" map');
    }
    return { default: doc.default, sources: doc.sources || {} };
}

// Resolve the full source set: the built-in public (always, authoritative) plus
// any user-added entries from the file. `public` is reserved — a file entry of
// that name cannot shadow the default.
function loadSources(brandRoot) {
    const doc = readSourcesFile(brandRoot);
    const sources = { ...doc.sources, public: { ...BUILTIN_PUBLIC } };
    const def = doc.default && Object.prototype.hasOwnProperty.call(sources, doc.default)
        ? doc.default
        : 'public';
    return { default: def, sources };
}

function resolveSource(sources, name) {
    if (Object.prototype.hasOwnProperty.call(sources, name)) return sources[name];
    throw codedError('INVALID_INPUT', `unknown template source "${name}" (valid: ${Object.keys(sources).join(', ')})`);
}

// Validate a stored source entry's schema. Returns an error string or null.
function validateSource(source) {
    if (!source || typeof source !== 'object') return 'source must be an object';
    if (!SOURCE_TYPES[source.type]) return `unknown source type "${source.type}"`;
    if (source.type === 'github' && !source.repo) return 'github source requires "repo"';
    if (source.type === 'local' && !source.path) return 'local source requires "path"';
    if (source.type === 'git' && !source.url) return 'git source requires "url"';
    return null;
}

// Validate user-entered fields for the interactive add flow. Returns an error
// string or null. (Only the picker-addable types: local, git.)
function validateSourceInput(type, fields) {
    fields = fields || {};
    if (type === 'local') {
        if (!String(fields.path || '').trim()) return 'path cannot be empty';
        return null;
    }
    if (type === 'git') {
        if (!String(fields.url || '').trim()) return 'url cannot be empty';
        return null;
    }
    return `unsupported source type "${type}"`;
}

// Build a source entry object from validated input. `ref` is omitted for git
// when blank (→ clone the remote default branch).
function buildSourceEntry(type, fields) {
    fields = fields || {};
    const label = String(fields.label || '').trim();
    if (type === 'local') {
        return { type: 'local', label, path: String(fields.path).trim() };
    }
    if (type === 'git') {
        const entry = { type: 'git', label, url: String(fields.url).trim() };
        const ref = String(fields.ref || '').trim();
        if (ref) entry.ref = ref;
        return entry;
    }
    throw codedError('INVALID_INPUT', `unsupported source type "${type}"`);
}

const RESERVED_SOURCE_KEYS = new Set(['public']);

// Add an entry under `key`. Immutable; throws on reserved key or duplicate.
function addSourceEntry(doc, key, entry) {
    if (RESERVED_SOURCE_KEYS.has(key)) {
        throw codedError('INVALID_INPUT', `"${key}" is a reserved source name`);
    }
    const sources = (doc && doc.sources) || {};
    if (Object.prototype.hasOwnProperty.call(sources, key)) {
        throw codedError('CONFLICT', `template source "${key}" already exists`);
    }
    return { ...doc, sources: { ...sources, [key]: entry } };
}

// Remove an entry. Immutable; no-op if absent.
function removeSourceEntry(doc, key) {
    const sources = { ...((doc && doc.sources) || {}) };
    delete sources[key];
    return { ...doc, sources };
}

function writeSources(brandRoot, doc) {
    const file = sourcesFilePath(brandRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const out = { sources: (doc && doc.sources) || {} };
    if (doc && doc.default) out.default = doc.default;
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
}

// Confirm a candidate source actually exposes a usable templates.json catalog.
// Uses the provider itself — one path for every type. For git this performs a
// real shallow clone (the only honest check without per-host file APIs).
// Returns { ok: true, count } or { ok: false, reason }.
async function validateSourceHasTemplates(source, ctx = {}) {
    let provider;
    try {
        provider = createProvider(source, ctx);
        const manifest = await provider.readJson('templates.json');
        const usable = selectableTemplates(manifest);
        if (usable.length === 0) return { ok: false, reason: 'templates.json has no selectable templates' };
        return { ok: true, count: usable.length };
    } catch (err) {
        return { ok: false, reason: (err && err.message) || 'could not read templates.json' };
    } finally {
        if (provider) provider.dispose();
    }
}

module.exports = {
    BUILTIN_PUBLIC,
    AI_CONTEXT_DOC_PATH,
    SOURCE_TYPES,
    // HTTP + fs primitives
    fetchBuffer,
    fetchJson,
    countFiles,
    copySubtree,
    extractTemplate,
    selectableTemplates,
    // providers
    PublicProvider,
    LocalRootProvider,
    createProvider,
    resolveLocalRoot,
    cloneToTemp,
    // registry
    readSourcesFile,
    loadSources,
    resolveSource,
    validateSource,
    validateSourceInput,
    buildSourceEntry,
    addSourceEntry,
    removeSourceEntry,
    writeSources,
    validateSourceHasTemplates,
};
