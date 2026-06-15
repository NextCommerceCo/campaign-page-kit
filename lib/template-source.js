'use strict';

const path = require('path');

// Resolve WHERE to fetch a starter-template's source.
//
// page-kit is source-agnostic. By default it fetches public families from the
// public Campaign Cart starter-templates repo, anonymously. A caller — an
// operator, or an orchestrator such as campaigns-os — can point `campaign-init`
// at a DIFFERENT repo/ref/subtree and mark it private (an outside, access-
// controlled template family) by passing --source-repo / --source-ref /
// --source-path / --private.
//
// This module holds NO per-family knowledge: which family lives in which repo,
// and whether it is private, is the caller's concern — never page-kit's. That
// keeps the build tool generic and the opinionated family→source mapping in the
// layer that owns it.

// The default: public Campaign Cart starter templates, fetched anonymously.
const DEFAULT_SOURCE = Object.freeze({
    repo: 'NextCommerceCo/campaign-cart-starter-templates',
    ref: 'main',
    // Directory under the repo root that holds per-slug template folders. The
    // family subtree extracted from the tarball is `${source_path}<slug>/`.
    source_path: 'src/',
    private: false,
});

function rawBase(repo, ref) {
    return `https://raw.githubusercontent.com/${repo}/${ref}`;
}

function pickString(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function invalidSource(message) {
    const error = new Error(message);
    error.code = 'INVALID_SOURCE';
    return error;
}

// This module is the trust boundary where caller-supplied source values meet URL
// construction and tarball extraction, so validate shape here (defense in depth
// — a programmatic caller bypassing the CLI is covered too). Throws INVALID_SOURCE
// on a malformed value.
//   - repo: strict "owner/repo" (no traversal, no query strings / odd chars).
//   - ref:  branch/tag/SHA; slashes allowed (feature/foo, refs/heads/x) but no
//           "..", no leading/trailing slash, no odd chars.
//   - source_path: a relative subtree only — reject "..", absolute, or "~" so
//           extractTemplate can never path.join its way out of the tarball tree.
function assertValidSource(repo, ref, source_path) {
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) || repo.includes('..')) {
        throw invalidSource(`invalid source repo "${repo}" — expected "owner/repo"`);
    }
    if (!/^[A-Za-z0-9._/-]+$/.test(ref) || ref.includes('..') || ref.startsWith('/') || ref.endsWith('/')) {
        throw invalidSource(`invalid source ref "${ref}"`);
    }
    // source_path is a POSIX subtree (tar entries use "/"). Reject backslashes so
    // the contract is platform-independent — otherwise a "src\\foo" would pass the
    // POSIX checks here but be reinterpreted as a separator by path.win32.join.
    const normalized = path.posix.normalize(source_path);
    if (source_path.includes('..') || source_path.includes('\0') || source_path.includes('\\') || source_path.startsWith('~')
        || normalized.startsWith('..') || path.posix.isAbsolute(normalized)) {
        throw invalidSource(`invalid source path "${source_path}" — must be a relative POSIX subtree (forward slashes only, no ".." segments)`);
    }
}

// Resolve a source descriptor (repo/ref/path/private + the concrete fetch URLs)
// by overlaying caller-supplied overrides on the public default. `overrides` is
// the shape produced from the CLI flags: { repo, ref, source_path, private }.
// Any unset field falls back to the public default — so resolveTemplateSource()
// with no argument is exactly the public starter-templates source.
function resolveTemplateSource(overrides = {}) {
    const o = overrides || {};
    const repo = pickString(o.repo, DEFAULT_SOURCE.repo);
    const ref = pickString(o.ref, DEFAULT_SOURCE.ref);
    const source_path = pickString(o.source_path, DEFAULT_SOURCE.source_path);
    const isPrivate = o.private == null ? DEFAULT_SOURCE.private : !!o.private;
    assertValidSource(repo, ref, source_path);
    return {
        repo,
        ref,
        source_path,
        private: isPrivate,
        templates_url: `${rawBase(repo, ref)}/templates.json`,
        campaigns_url: `${rawBase(repo, ref)}/_data/campaigns.json`,
        // Authenticated tarball (private sources): GitHub's API tarball endpoint
        // honors an Authorization header and 302-redirects to a signed codeload
        // URL. Named explicitly so a caller can't reach for it on a public source
        // and accidentally make an authenticated request — public sources use
        // tarball_url_anonymous below.
        tarball_url_authenticated: `https://api.github.com/repos/${repo}/tarball/${ref}`,
        // Anonymous codeload tarball (public sources).
        tarball_url_anonymous: `https://codeload.github.com/${repo}/tar.gz/refs/heads/${ref}`,
        ai_context_doc_url: `${rawBase(repo, ref)}/docs/campaign-page-kit-template-context.md`,
    };
}

module.exports = {
    DEFAULT_SOURCE,
    resolveTemplateSource,
};
