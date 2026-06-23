#!/usr/bin/env node

const { build } = require('../engine/build');
const logger = require('../logger');

const HELP_TEXT = `campaign-build — build campaign pages into _site/

Usage:
  campaign-build [flags]

Flags:
  --json        write a single machine-readable build summary to stdout
  --verbose     print debug diagnostics to stderr
  --help, -h    show this help and exit 0

campaign-build preserves existing files in _site/.

`;

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        process.stdout.write(HELP_TEXT);
        return;
    }

    // --json: machine-readable build summary on stdout, nothing else.
    // All diagnostics (warn/error/debug) go to stderr, so the output pipes
    // cleanly: campaign-build --json | jq '.pages'
    const json = args.includes('--json');
    const verbose = args.includes('--verbose');

    if (!json) logger.banner();
    const summary = await build({ verbose });

    if (json) {
        process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    } else {
        const { built, errors, warnings, ms } = summary;
        const timing = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
        const counts = [
            errors ? `${errors} error${errors !== 1 ? 's' : ''}` : null,
            warnings ? `${warnings} warning${warnings !== 1 ? 's' : ''}` : null,
        ].filter(Boolean).join(', ');
        logger.info(`Built ${built} page${built !== 1 ? 's' : ''} in ${timing}${counts ? ` (${counts})` : ''}`);
    }

    // exitCode (not process.exit) lets stdout/stderr drain before the process
    // ends — process.exit() can truncate buffered pipe output mid-write.
    if (summary.errors > 0) process.exitCode = 1;
}

main().catch(err => {
    logger.error(err.message);
    process.exitCode = 1;
});
