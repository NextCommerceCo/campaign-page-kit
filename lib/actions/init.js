#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const logger = require('../logger');

const D = '\x1b[90m';
const R = '\x1b[0m';

const CAMPAIGNS_JSON = JSON.stringify({}, null, 2) + '\n';

const SCRIPTS = {
    'setup': 'campaign-init',
    'start': 'campaign-start',
    'dev': 'campaign-dev',
    'build': 'campaign-build',
    'clone': 'campaign-clone',
    'config': 'campaign-config',
    'compress': 'campaign-compress',
    'compress:preview': 'campaign-compress --preview',
    'migrate': 'campaign-migrate',
};

const REPO = 'NextCommerceCo/campaign-cart-starter-templates';
const REF = 'main';
const TEMPLATES_URL = `https://raw.githubusercontent.com/${REPO}/${REF}/templates.json`;
const CAMPAIGNS_URL = `https://raw.githubusercontent.com/${REPO}/${REF}/_data/campaigns.json`;
const TARBALL_URL  = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${REF}`;

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

// Extract a single template's src/<slug>/ subtree from the upstream tarball
// using the system `tar` binary. No homemade parser, no truncation surprises.
function extractTemplate(tarball, slug, destDir) {
    const parent = path.dirname(destDir);
    fs.mkdirSync(parent, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(parent, '.cpk-extract-'));
    try {
        execSync('tar -xz', { input: tarball, cwd: tmpDir, stdio: ['pipe', 'ignore', 'pipe'] });
        const repoRoot = fs.readdirSync(tmpDir).find(d =>
            fs.statSync(path.join(tmpDir, d)).isDirectory()
        );
        if (!repoRoot) throw new Error('tarball had no top-level directory');
        const sourceDir = path.join(tmpDir, repoRoot, 'src', slug);
        if (!fs.existsSync(sourceDir)) {
            throw new Error(`upstream has no src/${slug}/`);
        }
        fs.cpSync(sourceDir, destDir, { recursive: true });
        return countFiles(destDir);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

function countFiles(dir) {
    let n = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
        else n++;
    }
    return n;
}

// Convert a free-form name into a valid campaign slug.
function slugify(s) {
    return String(s || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

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

// Produce the next state of `_data/campaigns.json` after merging an upstream
// entry under `localSlug` and overriding the name with what the user provided.
function mergeCampaignEntry(localCampaigns, localSlug, upstreamEntry, name) {
    const base = upstreamEntry || { description: '' };
    return { ...localCampaigns, [localSlug]: { ...base, name } };
}

// Merge missing CLI scripts into a package.json object. Returns
// { pkg, added: [keys] }; does not mutate the input.
function mergeScripts(pkg) {
    const next = { ...pkg, scripts: { ...(pkg && pkg.scripts || {}) } };
    const added = [];
    for (const [k, v] of Object.entries(SCRIPTS)) {
        if (!next.scripts[k]) {
            next.scripts[k] = v;
            added.push(k);
        }
    }
    return { pkg: next, added };
}

// Apply an API key to a config.js source string. Returns the new string,
// or null if no `apiKey:` field was found.
function applyApiKey(configSource, apiKey) {
    const updated = configSource.replace(/apiKey:\s*['"].*?['"]/, `apiKey: '${apiKey.trim()}'`);
    return updated === configSource ? null : updated;
}

async function main() {
    const { intro, select, confirm, text, log, outro, isCancel, spinner } = await import('@clack/prompts');

    intro('Next Campaign Page Kit — init');

    // 1. package.json scripts
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        const current = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const { pkg, added } = mergeScripts(current);
        if (added.length > 0) {
            fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
            log.success(`added package.json scripts: ${D}${added.join(', ')}${R}`);
        } else {
            log.step('package.json scripts already present');
        }
    } else {
        log.warn(`no package.json found — run ${D}npm init -y${R} first`);
    }

    // 2. _data/campaigns.json
    const campaignsDataPath = path.join(process.cwd(), '_data', 'campaigns.json');
    if (!fs.existsSync(campaignsDataPath)) {
        fs.mkdirSync(path.dirname(campaignsDataPath), { recursive: true });
        fs.writeFileSync(campaignsDataPath, CAMPAIGNS_JSON, 'utf8');
        log.success('created _data/campaigns.json');
    } else {
        log.step('_data/campaigns.json already exists');
    }

    // 3. fetch + show templates
    let manifest;
    try {
        manifest = await fetchJson(TEMPLATES_URL);
    } catch (err) {
        log.warn(`could not fetch templates: ${err.message}`);
        outro(`Run ${D}npm run dev${R} when ready.`);
        return;
    }

    const templates = selectableTemplates(manifest);

    if (templates.length === 0) {
        outro(`Run ${D}npm run dev${R} when ready.`);
        return;
    }

    const slug = await select({
        message: 'Pick a starter template',
        options: templates.map(t => ({
            value: t.slug,
            label: t.deprecated ? `[DEPRECATED] ${t.name}` : t.name,
            hint: t.description || t.slug,
        })),
    });
    if (isCancel(slug)) { outro('Cancelled.'); return; }
    const picked = templates.find(t => t.slug === slug);

    // 4a. campaign name (defaults to upstream template name)
    const name = await text({
        message: 'Campaign name',
        placeholder: picked.name,
        initialValue: picked.name,
        validate: (v) => {
            if (!(v || '').trim()) return 'name cannot be empty';
        },
    });
    if (isCancel(name)) { outro('Cancelled.'); return; }
    const finalName = name.trim();

    // 4b. local slug (defaults to a slugified version of the name)
    const defaultSlug = slugify(finalName) || slug;
    const localSlug = await text({
        message: 'Local campaign slug',
        placeholder: defaultSlug,
        initialValue: defaultSlug,
        validate: (v) => {
            const t = (v || '').trim();
            if (!t) return 'slug cannot be empty';
            if (!/^[a-z0-9][a-z0-9-]*$/.test(t)) return 'lowercase letters, digits, hyphens only';
        },
    });
    if (isCancel(localSlug)) { outro('Cancelled.'); return; }
    const finalSlug = localSlug.trim();

    // 5. overwrite check
    const destDir = path.join(process.cwd(), 'src', finalSlug);
    if (fs.existsSync(destDir)) {
        const ok = await confirm({ message: `src/${finalSlug}/ already exists. Overwrite?`, initialValue: false });
        if (isCancel(ok) || !ok) { outro('Cancelled.'); return; }
        fs.rmSync(destDir, { recursive: true, force: true });
    }

    // 6. download + extract
    const sp = spinner();
    sp.start(`Downloading ${slug}`);
    try {
        const tarball = await fetchBuffer(TARBALL_URL);
        const written = extractTemplate(tarball, slug, destDir);
        sp.stop(`Wrote ${written} files to src/${finalSlug}/`);
    } catch (err) {
        sp.stop('Download failed');
        log.error(err.message);
        outro('Template install failed.');
        return;
    }

    // 7. merge upstream campaigns.json entry into local registry under finalSlug,
    //    overriding name with what the user provided
    try {
        const upstream = await fetchJson(CAMPAIGNS_URL);
        const local = JSON.parse(fs.readFileSync(campaignsDataPath, 'utf8'));
        const next = mergeCampaignEntry(local, finalSlug, upstream[slug], finalName);
        fs.writeFileSync(campaignsDataPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
        log.success(`Registered ${D}${finalSlug}${R} in _data/campaigns.json`);
    } catch (err) {
        log.warn(`could not merge registry entry: ${err.message}`);
    }

    // 8. optional: set API key
    const wantsKey = await confirm({ message: 'Set the Campaign API key now?', initialValue: true });
    if (!isCancel(wantsKey) && wantsKey) {
        const apiKey = await text({
            message: 'API key',
            placeholder: 'your-api-key',
            validate: (v) => { if (!(v || '').trim()) return 'API key cannot be empty'; },
        });
        if (!isCancel(apiKey)) {
            const configPath = path.join(destDir, 'assets', 'config.js');
            try {
                const updated = applyApiKey(fs.readFileSync(configPath, 'utf8'), apiKey);
                if (updated === null) {
                    log.warn(`no apiKey field found in assets/config.js — set it manually`);
                } else {
                    fs.writeFileSync(configPath, updated, 'utf8');
                    log.success('API key written to assets/config.js');
                }
            } catch (err) {
                log.warn(`could not write API key: ${err.message}`);
            }
        }
    }

    outro(`Next step: ${D}npm run dev${R} — preview ${finalSlug}`);
}

if (require.main === module) {
    main().catch(err => {
        logger.error(err.message);
        process.exit(1);
    });
}

module.exports = {
    SCRIPTS,
    slugify,
    selectableTemplates,
    mergeCampaignEntry,
    mergeScripts,
    applyApiKey,
    extractTemplate,
    countFiles,
};
