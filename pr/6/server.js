const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;

const DEBUG = process.argv.includes('--debug') || process.env.NEST_DEBUG === '1' || process.env.NEST_DEBUG === 'true';

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.jsonl': 'application/jsonl'
};

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url);
    let pathname = parsedUrl.pathname;
    
    // Default to index.html
    if (pathname === '/') {
        pathname = '/index.html';
    }
    
    const filePath = path.join(__dirname, pathname);
    const ext = path.extname(filePath);
    const mimeType = mimeTypes[ext] || 'text/plain';
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
            }
        } else {
            let body = data;

            // In debug mode, expose a global flag so the client logs the exact
            // prompt and summarized data to the browser console before sending.
            if (DEBUG && ext === '.html') {
                const html = data.toString('utf8');
                const injection = '<script>window.NEST_DEBUG = true;</script>';
                body = html.includes('</head>')
                    ? html.replace('</head>', `${injection}\n</head>`)
                    : `${injection}\n${html}`;
            }

            res.writeHead(200, { 
                'Content-Type': mimeType,
                'Access-Control-Allow-Origin': '*'
            });
            res.end(body);
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Nest Data Viewer server running at http://localhost:${PORT}`);
    console.log('📁 Place your JSONL file in this directory and upload it via the web interface');
    if (DEBUG) {
        console.log('🐞 Debug mode ON — AI prompts/data will be logged to the browser console before each request');
    }
});

// Set max listeners to avoid warning
server.setMaxListeners(15);

let isShuttingDown = false;

// Graceful shutdown function
function gracefulShutdown(signal) {
    if (isShuttingDown) {
        console.log('👋 Force shutdown...');
        process.exit(1);
    }
    
    isShuttingDown = true;
    console.log(`\n👋 Server shutting down gracefully... (received ${signal})`);
    console.log('Press Ctrl+C again to force shutdown');
    
    server.close(() => {
        console.log('✅ Server closed successfully');
        process.exit(0);
    });
    
    // Force shutdown after 5 seconds if graceful shutdown fails
    setTimeout(() => {
        console.log('⚠️  Force shutdown due to timeout');
        process.exit(1);
    }, 5000);
}

// Handle different shutdown signals
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
