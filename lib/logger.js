const BRAND = '\x1b[38;2;50;102;255m'; // #3266ff
const TAG = `${BRAND}[NEXT]\x1b[0m`;

const info  = (msg) => console.log(`${TAG} ${BRAND}INFO\x1b[0m  ${msg}`);
const warn  = (msg) => console.warn(`${TAG} \x1b[33mWARN\x1b[0m  ${msg}`);
const error = (msg) => console.error(`${TAG} \x1b[31mERROR\x1b[0m ${msg}`);
// Diagnostics go to stderr (like warn/error) so stdout stays reserved for
// primary output — required for `campaign-build --json | jq` to work.
const debug = (msg, opts = {}) => {
    const enabled = Object.prototype.hasOwnProperty.call(opts, 'enabled') ? opts.enabled : true;
    if (enabled) console.error(`${TAG} \x1b[90mDEBUG\x1b[0m ${msg}`);
};

const LOGO_LINES = [
    '███╗   ██╗███████╗██╗  ██╗████████╗',
    '████╗  ██║██╔════╝╚██╗██╔╝╚══██╔══╝',
    '██╔██╗ ██║█████╗   ╚███╔╝    ██║   ',
    '██║╚██╗██║██╔══╝   ██╔██╗    ██║   ',
    '██║ ╚████║███████╗██╔╝ ██╗   ██║   ',
    '╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝   ╚═╝   ',
];
// Six-step fade of brand #3266ff from full intensity (top) toward a darker
// navy (bottom), matching the light→dark direction of the original gray ramp.
const BRAND_FADE = [
    '\x1b[38;2;50;102;255m',
    '\x1b[38;2;46;94;235m',
    '\x1b[38;2;42;86;214m',
    '\x1b[38;2;38;78;194m',
    '\x1b[38;2;34;69;173m',
    '\x1b[38;2;30;61;153m',
];
const RESET = '\x1b[0m';

const banner = () => {
    console.log();
    LOGO_LINES.forEach((line, i) => console.log(`${BRAND_FADE[i]}${line}${RESET}`));
    console.log();
};

module.exports = { info, warn, error, debug, banner, BRAND };
