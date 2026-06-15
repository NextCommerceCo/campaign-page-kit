'use strict';

// Template-source registry — the single source of truth for WHERE a template
// family's source lives.
//
// `campaign-init` (lib/actions/init.js) fetches starter-template source from a
// GitHub repo. Public families live in the public starter-templates repo and are
// fetched unauthenticated. Private families (e.g. Adsbranded's `arjuna`) live in a
// private repo and need an authenticated tarball fetch. This module maps a family
// slug to its source so the fetch logic stays declarative and there is exactly one
// place that knows the repo/ref/path layout.
//
// Keyed by family slug. For starter templates the slug IS the family name
// (olympus, demeter, arjuna, …) and the template subtree is `<source_path><slug>/`.
//
// Private families are deliberately NOT registered in any public `templates.json`,
// so they never surface in the interactive picker — they only resolve when an
// operator passes the slug explicitly (`--template arjuna`, or a campaigns-os
// `--template-family arjuna` / CampaignSpec `preferred_template_family`).

// The default: public Campaign Cart starter templates, fetched anonymously.
const DEFAULT_SOURCE = Object.freeze({
    repo: 'NextCommerceCo/campaign-cart-starter-templates',
    ref: 'main',
    // Directory under the repo root that holds per-slug template folders. The
    // family subtree extracted from the tarball is `${source_path}${slug}/`.
    source_path: 'src/',
    private: false,
});

// Per-family overrides. Anything not listed here resolves to DEFAULT_SOURCE.
const FAMILY_SOURCES = Object.freeze({
    // Adsbranded-owned private template families live in their own repo.
    arjuna: Object.freeze({
        repo: 'Sellmore-Co/adsbranded-templates',
        ref: 'main',
        source_path: 'src/',
        private: true,
    }),
});

function rawBase(repo, ref) {
    return `https://raw.githubusercontent.com/${repo}/${ref}`;
}

// Resolve the source descriptor for a family/slug, including the concrete fetch
// URLs. `family` may be empty/undefined — that resolves to the public default,
// which is what the interactive picker and any public `--template <slug>` use.
function resolveTemplateSource(family) {
    const key = typeof family === 'string' ? family.trim() : '';
    const base = (key && FAMILY_SOURCES[key]) || DEFAULT_SOURCE;
    const { repo, ref } = base;
    return {
        family: key || null,
        repo,
        ref,
        source_path: base.source_path,
        private: !!base.private,
        templates_url: `${rawBase(repo, ref)}/templates.json`,
        campaigns_url: `${rawBase(repo, ref)}/_data/campaigns.json`,
        // GitHub's API tarball endpoint honors an Authorization header and
        // 302-redirects to a signed codeload URL — the path private repos need.
        // Public families can use the same endpoint anonymously, but init.js
        // keeps the historical anonymous codeload URL for them; this is the
        // authenticated form used for private fetches.
        tarball_url: `https://api.github.com/repos/${repo}/tarball/${ref}`,
        // Anonymous codeload tarball (public families only).
        tarball_url_anonymous: `https://codeload.github.com/${repo}/tar.gz/refs/heads/${ref}`,
        ai_context_doc_url: `${rawBase(repo, ref)}/docs/campaign-page-kit-template-context.md`,
    };
}

// Convenience: is this family served from a private repo (needs a token)?
function isPrivateFamily(family) {
    return !!resolveTemplateSource(family).private;
}

module.exports = {
    DEFAULT_SOURCE,
    FAMILY_SOURCES,
    resolveTemplateSource,
    isPrivateFamily,
};
