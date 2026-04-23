const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.DEMO_PORT || 3004;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function resolveFilePath(urlPath) {
  if (urlPath === '/' || urlPath === '/login') return path.join(__dirname, 'login.html');
  if (urlPath === '/dashboard') return path.join(__dirname, 'index.html');
  return path.join(__dirname, decodeURIComponent(urlPath));
}

http.createServer((req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const filePath = resolveFilePath(reqUrl.pathname);
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (_) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server error');
  }
}).listen(PORT, () => {
  console.log(`Gordon UI → http://localhost:${PORT}/login`);
});
