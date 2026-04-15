#!/usr/bin/env node

const { build } = require('../engine/build');
const logger = require('../logger');

function parseLenient(argv) {
    return argv.slice(2).includes('--lenient');
}

async function main() {
    const lenient = parseLenient(process.argv);
    const { built, errors, funnelErrors = 0, ms } = await build({ lenient });
    const timing = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
    const totalErrors = errors + funnelErrors;
    logger.info(`Built ${built} page${built !== 1 ? 's' : ''} in ${timing}${totalErrors ? ` (${totalErrors} error${totalErrors !== 1 ? 's' : ''})` : ''}`);
    if (totalErrors > 0) process.exit(1);
}

main().catch(err => {
    logger.error(err.message);
    process.exit(1);
});
