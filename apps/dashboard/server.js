const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.DASHBOARD_PORT || '3002', 10);

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(500); res.end('Error'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
