#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const root = path.resolve(__dirname, "..");
const defaultPort = 4173;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const port = readPort();

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(root, relative);

  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    send(response, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      send(response, 404, "Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(port, "::", () => {
  console.log(`Serving ${root}`);
  console.log(`http://localhost:${port}`);
});

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

function readPort() {
  const args = process.argv.slice(2);
  const explicit = readPortFlag(args) || readBarePort(args) || process.env.PORT;
  const parsed = Number(explicit || defaultPort);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.error("Port must be an integer from 1 to 65535.");
    process.exit(1);
  }

  return parsed;
}

function readPortFlag(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if ((arg === "--port" || arg === "-p") && args[index + 1]) {
      return args[index + 1];
    }
    if (arg.startsWith("--port=")) {
      return arg.slice("--port=".length);
    }
  }
  return "";
}

function readBarePort(args) {
  return args.find((arg) => /^\d+$/.test(arg)) || "";
}
