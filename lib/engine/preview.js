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

function previewLink(value, pageUrl, pageRoutes) {
    // A CSP on this document does not protect a top-level destination. Only
    // rendered preview pages are navigable; even same-origin assets may run JS.
    if (/^[a-z][a-z\d+.-]*:/i.test(value.trim())) return null;
    try {
        const target = new URL(value, `https://preview.invalid${pageUrl}`);
        if (target.origin !== 'https://preview.invalid') return null;
        if (value.trim().startsWith('#')) return value;
        const route = pageRoutes.get(target.pathname);
        return route ? `${route}${target.search}${target.hash}` : null;
    } catch { return null; }
}

function makeStaticPreview(html, { pageUrl = '/', pageRoutes = new Map() } = {}) {
    const document = parse(html);
    function clean(parent) {
        parent.childNodes = (parent.childNodes || []).filter(node => {
            const attr = name => node.attrs?.find(a => a.name === name)?.value || '';
            if (['script', 'iframe', 'object', 'embed', 'base', 'animate', 'set'].includes(node.tagName)) return false;
            if (node.tagName === 'meta') {
                const httpEquiv = attr('http-equiv').trim().toLowerCase();
                if (['refresh', 'content-security-policy-report-only'].includes(httpEquiv)) return false;
                if (httpEquiv === 'content-security-policy') {
                    const content = node.attrs.find(a => a.name === 'content');
                    if (content) content.value = content.value.split(';').map(directive => directive.trim())
                        .filter(directive => !/^(report-uri|report-to)(?:\s|$)/i.test(directive)).join('; ');
                }
            }
            // Resource hints may open connections even without a script. Retain
            // only local visual resources; no prefetch, preconnect or DNS hints.
            if (node.tagName === 'link' && (!['stylesheet', 'icon', 'shortcut icon', 'apple-touch-icon'].includes(attr('rel').toLowerCase()) || !localLink(attr('href')))) return false;
            if (node.attrs) node.attrs = node.attrs.filter(a => !a.name.startsWith('on') && a.name !== 'ping');
            if (['a', 'area'].includes(node.tagName) && node.attrs.some(a => a.name === 'href')) {
                const href = previewLink(attr('href'), pageUrl, pageRoutes);
                node.attrs = node.attrs.filter(a => a.name !== 'href');
                if (href !== null) node.attrs.push({ name: 'href', value: href });
                else if (!node.attrs.some(a => a.name === 'aria-disabled')) node.attrs.push({ name: 'aria-disabled', value: 'true' });
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
    // Keep authored enforcement, excluding reporting directives: browsers
    // enforce multiple policies together, so an additional policy can restrict
    // but cannot relax this preview policy. Preview must not request telemetry.
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
