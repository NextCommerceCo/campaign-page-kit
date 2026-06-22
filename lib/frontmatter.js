const yaml = require('js-yaml');

function parseFrontmatter(raw) {
    const text = raw.replace(/^\uFEFF/, '');
    const firstLine = readLine(text, 0);

    if (!firstLine || firstLine.value.trim() !== '---') {
        return { data: {}, content: text };
    }

    let cursor = firstLine.next;
    let closing = null;
    while (cursor < text.length) {
        const line = readLine(text, cursor);
        if (line.value.trim() === '---') {
            closing = line;
            break;
        }
        cursor = line.next;
    }

    if (!closing) {
        throw new Error('frontmatter missing closing ---');
    }

    const source = text.slice(firstLine.next, closing.start).replace(/\r?\n$/, '');
    const data = source.trim() ? yaml.load(source) : {};

    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('frontmatter must be a YAML object');
    }

    return {
        data,
        // Preserve page-kit's existing body contract: content starts after the
        // closing fence newline, matching the renderer tests.
        content: text.slice(closing.next),
    };
}

function readLine(text, start) {
    if (start > text.length) return null;

    const lineFeed = text.indexOf('\n', start);
    if (lineFeed === -1) {
        return {
            start,
            value: text.slice(start),
            next: text.length,
        };
    }

    const valueEnd = lineFeed > start && text[lineFeed - 1] === '\r'
        ? lineFeed - 1
        : lineFeed;

    return {
        start,
        value: text.slice(start, valueEnd),
        next: lineFeed + 1,
    };
}

module.exports = { parseFrontmatter };
