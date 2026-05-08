#!/usr/bin/env node

const { build } = require('../engine/build');
const logger = require('../logger');

async function main() {
    logger.banner();
    const { built, errors, ms } = await build();
    const timing = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
    logger.info(`Built ${built} page${built !== 1 ? 's' : ''} in ${timing}${errors ? ` (${errors} error${errors !== 1 ? 's' : ''})` : ''}`);
    if (errors > 0) process.exit(1);
}

main().catch(err => {
    logger.error(err.message);
    process.exit(1);
});
