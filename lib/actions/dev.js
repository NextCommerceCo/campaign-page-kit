#!/usr/bin/env node

const path = require('path');
const { execSync } = require('child_process');
const config = require('../config');
const { build } = require('../engine/build');
const { serve } = require('../engine/serve');
const logger = require('../logger');

function isValidPort(n) {
    return Number.isInteger(n) && n >= 1 && n <= 65535;
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
        const { built, errors, funnelErrors = 0, ms } = await build({ campaigns, mode: 'development' });
        const timing = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
        const totalErrors = errors + funnelErrors;
        logger.info(`Built ${built} page${built !== 1 ? 's' : ''} in ${timing}${totalErrors ? ` (${totalErrors} error${totalErrors !== 1 ? 's' : ''})` : ''}`);
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

            const { built, errors, funnelErrors = 0, ms } = await build({ campaigns: { [slug]: campaigns[slug] }, files, mode: 'development' });
            const timing = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
            if (files && files.length === 0) {
                logger.info(`Assets copied in ${timing}`);
            } else {
                const totalErrors = errors + funnelErrors;
                logger.info(`Rebuilt ${built} page${built !== 1 ? 's' : ''} in ${timing}${totalErrors ? ` (${totalErrors} error${totalErrors !== 1 ? 's' : ''})` : ''}`);
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

module.exports = { runDevServer, parsePort };
