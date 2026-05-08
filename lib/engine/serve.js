/**
 * Campaign dev server.
 *
 * Serves _site/ as static files, watches src/ for changes, rebuilds on change,
 * and pushes live reload notifications to connected browsers via SSE.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const logger = require('../logger');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain',
};

// Injected before </body> in every HTML response
const LIVERELOAD_SCRIPT = `<script>
(function() {
  const es = new EventSource('/_lr');
  es.onmessage = () => location.reload();
  es.onerror = () => setTimeout(() => location.reload(), 1000);
})();
</script>`;

/**
 * Start the dev server.
 *
 * @param {object}   opts
 * @param {string}   opts.outputPath  - Directory to serve (_site/)
 * @param {string}   opts.srcPath     - Directory to watch for changes (src/)
 * @param {number}   [opts.port=3000] - HTTP port
 * @param {Function} opts.onRebuild   - Async function called on file change; receives changed path
 * @returns {{ server, watcher, reload }}
 */
function serve({ outputPath, srcPath, port = 3000, onRebuild }) {
    const sseClients = new Set();

    const server = http.createServer((req, res) => {
        const urlPath = req.url.split('?')[0];

        // SSE live reload endpoint
        if (urlPath === '/_lr') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            res.write(': connected\n\n');
            sseClients.add(res);
            req.on('close', () => sseClients.delete(res));
            return;
        }

        // Resolve file path
        let filePath = path.join(outputPath, urlPath);

        // Directory → index.html
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }

        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

        try {
            let content = fs.readFileSync(filePath);

            if (ext === '.html') {
                const html = content.toString();
                const injected = html.includes('</body>')
                    ? html.replace('</body>', `${LIVERELOAD_SCRIPT}</body>`)
                    : html + LIVERELOAD_SCRIPT;
                content = Buffer.from(injected);
            }

            res.writeHead(200, { 'Content-Type': mimeType });
            res.end(content);
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Server error');
        }
    });

    function reload() {
        for (const client of sseClients) {
            client.write('data: reload\n\n');
        }
    }

    let rebuilding = false;

    async function handleChange(changedPath) {
        if (rebuilding) return;
        rebuilding = true;
        try {
            if (changedPath) {
                const rel = path.relative(process.cwd(), changedPath);
                logger.info(`File changed: \x1b[90m${rel}\x1b[0m`);
            }
            await onRebuild(changedPath);
            reload();
        } catch (e) {
            logger.error(`Build error: ${e.message}`);
        } finally {
            rebuilding = false;
        }
    }

    const watcher = chokidar.watch(srcPath, {
        ignoreInitial: true,
        ignored: /(^|[/\\])\../,
    });

    watcher.on('change', handleChange);
    watcher.on('add', handleChange);
    watcher.on('unlink', handleChange);

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logger.error(`Port ${port} is already in use. Use --port or -p to specify a different port.`);
        } else {
            logger.error(`Server error: ${err.message}`);
        }
        process.exit(1);
    });

    server.listen(port, () => {
        logger.info(`Server at ${logger.BRAND}http://localhost:${port}/\x1b[0m`);
    });

    return { server, watcher, reload };
}

module.exports = { serve };
