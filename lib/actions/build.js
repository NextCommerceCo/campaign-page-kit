#!/usr/bin/env node

const { build } = require('../engine/build');
const { parseFlag, formatBuildSummary } = require('../config');
const logger = require('../logger');

async function main() {
    const lenient = parseFlag(process.argv, '--lenient');
    const { built, errors, funnelErrors = 0, ms } = await build({ lenient });
    const timing = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
    const totalErrors = errors + funnelErrors;
    logger.info(formatBuildSummary(built, totalErrors, timing));
    if (totalErrors > 0) process.exit(1);
}

main().catch(err => {
    logger.error(err.message);
    process.exit(1);
});
