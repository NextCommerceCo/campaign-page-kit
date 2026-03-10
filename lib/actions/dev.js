#!/usr/bin/env node

const path = require('path');
const { execSync } = require('child_process');
const config = require('../config');
const { build } = require('../engine/build');
const { serve } = require('../engine/serve');
const logger = require('../logger');

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
    const port = 3000;

    console.log('');

    // Initial build
    try {
        const { built, errors, ms } = await build({ campaigns });
        const timing = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
        logger.info(`Built ${built} page${built !== 1 ? 's' : ''} in ${timing}${errors ? ` (${errors} error${errors !== 1 ? 's' : ''})` : ''}`);
    } catch (e) {
        logger.error(`Initial build failed: ${e.message}`);
        process.exit(1);
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

            const { built, errors, ms } = await build({ campaigns: { [slug]: campaigns[slug] }, files });
            const timing = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
            if (files && files.length === 0) {
                logger.info(`Assets copied in ${timing}`);
            } else {
                logger.info(`Rebuilt ${built} page${built !== 1 ? 's' : ''} in ${timing}${errors ? ` (${errors} error${errors !== 1 ? 's' : ''})` : ''}`);
            }
        },
    });

    const url = `http://localhost:${port}/${slug}/`;
    logger.info(`Watching for changes…`);
    logger.info(`Campaign URL: \x1b[36m${url}\x1b[0m`);

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
    intro('Next Campaign Page Kit — local dev server');
    await runDevServer(campaigns);
}

if (require.main === module) {
    main().catch(err => {
        logger.error(err.message);
        process.exit(1);
    });
}

module.exports = { runDevServer };
