const { parse, parseFragment, serialize } = require('parse5');

// Preview is static even in a production build. Local CSS/images/fonts remain
// available, but SDKs, vendor pixels, forms and embedded payment pages cannot run.
const PREVIEW_POLICY = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";
const PREVIEW_MESSAGE = 'Unconfigured preview: commerce, forms, scripts and tracking are disabled. This is not a functional checkout.';

function localLink(value) {
    try {
        return new URL(value, 'https://preview.invalid/').origin === 'https://preview.invalid';
    } catch { return false; }
}

function makeStaticPreview(html) {
    const document = parse(html);
    function clean(parent) {
        parent.childNodes = (parent.childNodes || []).filter(node => {
            const attr = name => node.attrs?.find(a => a.name === name)?.value || '';
            if (['script', 'iframe', 'object', 'embed', 'base'].includes(node.tagName)) return false;
            if (node.tagName === 'meta' && attr('http-equiv').toLowerCase() === 'refresh') return false;
            // Resource hints may open connections even without a script. Retain
            // only local visual resources; no prefetch, preconnect or DNS hints.
            if (node.tagName === 'link' && (!['stylesheet', 'icon', 'shortcut icon', 'apple-touch-icon'].includes(attr('rel').toLowerCase()) || !localLink(attr('href')))) return false;
            if (node.attrs) node.attrs = node.attrs.filter(a => !a.name.startsWith('on') && a.name !== 'ping');
            if (node.tagName === 'a' && !localLink(attr('href'))) {
                node.attrs = node.attrs.filter(a => a.name !== 'href');
                node.attrs.push({ name: 'aria-disabled', value: 'true' });
            }
            if (['input', 'select', 'textarea', 'button'].includes(node.tagName) && !node.attrs.some(a => a.name === 'disabled')) node.attrs.push({ name: 'disabled', value: '' });
            clean(node);
            if (node.content) clean(node.content);
            return true;
        });
    }
    clean(document);
    const root = document.childNodes.find(n => n.tagName === 'html');
    const head = root.childNodes.find(n => n.tagName === 'head');
    const body = root.childNodes.find(n => n.tagName === 'body');
    // Keep authored policies: browsers enforce multiple policies together, so
    // an additional policy can restrict but cannot relax this preview policy.
    // frame-ancestors and sandbox are unsupported in CSP meta delivery; framing
    // restrictions must be configured by the host's response headers.
    const policy = parseFragment(`<meta http-equiv="Content-Security-Policy" content="${PREVIEW_POLICY}"><meta charset="utf-8"><meta name="referrer" content="no-referrer">`).childNodes;
    policy.forEach(n => { n.parentNode = head; });
    head.childNodes.unshift(...policy);
    const banner = parseFragment(`<aside role="status" data-cpk-preview style="display:block!important;padding:12px!important;background:#fff4cc!important;color:#29220c!important;font:16px/1.4 sans-serif!important">${PREVIEW_MESSAGE}</aside>`).childNodes[0];
    banner.parentNode = body;
    body.childNodes.unshift(banner);
    return serialize(document);
}

module.exports = { makeStaticPreview, PREVIEW_POLICY, PREVIEW_MESSAGE };
