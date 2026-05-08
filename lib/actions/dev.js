#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const config = require('../config');
const { build } = require('../engine/build');
const { serve } = require('../engine/serve');
const logger = require('../logger');

function isValidPort(n) {
    return Number.isInteger(n) && n >= 1 && n <= 65535;
}

// Normalize an `entry_url` campaign field into a URL suffix appended after
// `/<slug>/`. Accepts forms like "presell", "presell.html", "/presell",
// "/presell/", or "checkout/step-1" and returns "presell/", "checkout/step-1/",
// or "" when missing/empty.
function normalizeEntryUrl(entryUrl) {
    if (typeof entryUrl !== 'string') return '';
    const trimmed = entryUrl.trim().replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '');
    return trimmed ? `${trimmed}/` : '';
}

function buildDevUrl(port, slug, entryUrl) {
    const raw = typeof entryUrl === 'string' ? entryUrl : '';
    const qIdx = raw.indexOf('?');
    const pathPart = qIdx === -1 ? raw : raw.slice(0, qIdx);
    const existingQuery = qIdx === -1 ? '' : raw.slice(qIdx + 1);
    const query = existingQuery ? `?${existingQuery}&debugger=true` : '?debugger=true';
    return `http://localhost:${port}/${slug}/${normalizeEntryUrl(pathPart)}${query}`;
}

// Verify that a campaign's `entry_url` resolves to an actual source HTML file
// under `src/<slug>/`. Returns null if the entry_url is missing/empty or the
// page exists, otherwise an error message naming the missing file.
function validateEntryUrl(srcPath, slug, entryUrl) {
    if (typeof entryUrl !== 'string') return null;
    const pathOnly = entryUrl.split('?', 1)[0];
    const trimmed = pathOnly.trim().replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '');
    if (!trimmed) return null;
    const candidate = path.join(srcPath, slug, `${trimmed}.html`);
    if (!fs.existsSync(candidate)) {
        return `entry_url "${entryUrl}" for campaign "${slug}" does not match a page in src/${slug}/ (looked for ${trimmed}.html)`;
    }
    return null;
}

function parsePort(argv) {
    const args = argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-p' || args[i] === '--port') {
            const val = parseInt(args[i + 1], 10);
            if (!isValidPort(val)) {
                const logger = require('../logger');
                logger.error(`Invalid port value "${args[i + 1] || ''}". Must be a number between 1 and 65535.`);
                process.exit(1);
            }
            return val;
        }
        if (args[i].startsWith('--port=')) {
            const val = parseInt(args[i].split('=')[1], 10);
            if (!isValidPort(val)) {
                const logger = require('../logger');
                logger.error(`Invalid port value "${args[i].split('=')[1]}". Must be a number between 1 and 65535.`);
                process.exit(1);
            }
            return val;
        }
    }
    // Support bare number as first positional arg (e.g. `npm run dev 3333`)
    if (args.length && /^\d+$/.test(args[0])) {
        const val = parseInt(args[0], 10);
        if (!isValidPort(val)) {
            const logger = require('../logger');
            logger.error(`Invalid port value "${args[0]}". Must be a number between 1 and 65535.`);
            process.exit(1);
        }
        return val;
    }
    const envPort = parseInt(process.env.PORT, 10);
    if (process.env.PORT !== undefined && !isValidPort(envPort)) {
        const logger = require('../logger');
        logger.error(`Invalid PORT environment variable "${process.env.PORT}". Must be a number between 1 and 65535.`);
        process.exit(1);
    }
    return envPort || 3000;
}

async function runDevServer(campaigns) {
    const { select, isCancel } = await import('@clack/prompts');
    const list = config.campaignsArray(campaigns);

    const slug = await select({
        message: 'Select a campaign',
        options: list.map(c => ({
            value: c.slug,
            label: c.name,
            hint: `/${c.slug}/`,
        })),
    });

    if (isCancel(slug)) process.exit(0);

    const outputPath = config.getOutputPath();
    const srcPath = config.getSrcPath();
    const port = parsePort(process.argv);

    console.log('');

    // Initial build
    try {
        const { built, errors, ms } = await build({ campaigns, mode: 'development' });
        const timing = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
        logger.info(`Built ${built} page${built !== 1 ? 's' : ''} in ${timing}${errors ? ` (${errors} error${errors !== 1 ? 's' : ''})` : ''}`);
    } catch (e) {
        logger.error(`Initial build failed: ${e.message}`);
        process.exit(1);
    }

    const entryUrl = campaigns[slug] && campaigns[slug].entry_url;
    if (typeof entryUrl !== 'string' || !entryUrl.trim()) {
        logger.warn(`No entry_url set for campaign "${slug}" — opening campaign root. Add "entry_url" to _data/campaigns.json to point npm run dev at a specific page (e.g. "presell").`);
    } else {
        const entryUrlWarning = validateEntryUrl(srcPath, slug, entryUrl);
        if (entryUrlWarning) {
            logger.warn(entryUrlWarning);
        }
    }

    // Start server with file watching
    const { server, watcher } = serve({
        outputPath,
        srcPath,
        port,
        onRebuild: async (changedPath) => {
            let files;
            if (changedPath) {
                const rel = path.relative(srcPath, changedPath);
                const parts = rel.split(path.sep);
                const isIncludeOrLayout = parts.includes('_includes') || parts.includes('_layouts');
                if (rel.endsWith('.html') && !isIncludeOrLayout) {
                    files = [rel];
                } else if (!rel.endsWith('.html')) {
                    files = [];
                }
            }

            const { built, errors, ms } = await build({ campaigns: { [slug]: campaigns[slug] }, files, mode: 'development' });
            const timing = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
            if (files && files.length === 0) {
                logger.info(`Assets copied in ${timing}`);
            } else {
                logger.info(`Rebuilt ${built} page${built !== 1 ? 's' : ''} in ${timing}${errors ? ` (${errors} error${errors !== 1 ? 's' : ''})` : ''}`);
            }
        },
    });

    const url = buildDevUrl(port, slug, campaigns[slug] && campaigns[slug].entry_url);
    logger.info(`Watching for changes…`);
    logger.info(`Campaign URL: ${logger.BRAND}${url}\x1b[0m`);

    // Open browser
    const openCommand = process.platform === 'darwin' ? 'open' :
        process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
        execSync(`${openCommand} ${url}`, { stdio: 'ignore' });
    } catch (_) {
        // silently ignore if open fails
    }

    process.on('SIGINT', () => {
        server.close();
        watcher.close();
        process.exit();
    });
}

async function main() {
    const { intro } = await import('@clack/prompts');
    const campaigns = config.loadCampaigns();
    logger.banner();
    intro('Next Campaign Page Kit — local dev server');
    await runDevServer(campaigns);
}

if (require.main === module) {
    main().catch(err => {
        logger.error(err.message);
        process.exit(1);
    });
}

module.exports = { runDevServer, parsePort, normalizeEntryUrl, buildDevUrl, validateEntryUrl };
