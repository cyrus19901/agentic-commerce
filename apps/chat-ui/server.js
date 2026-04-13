const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.UI_PORT || '3000', 10);
const API_BASE_URL = process.env.UI_API_BASE_URL || 'http://localhost:3001';

const indexPath = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(indexPath, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to load UI');
        return;
      }
      const rendered = html.replaceAll('__API_BASE_URL__', API_BASE_URL);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(rendered);
    });
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uiPort: PORT, apiBaseUrl: API_BASE_URL }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`UI running on http://localhost:${PORT}`);
  console.log(`API target: ${API_BASE_URL}`);
});
