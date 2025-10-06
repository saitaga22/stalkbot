'use strict';

const express = require('express');

let serverInstance = null;

function startKeepAlive() {
  if (serverInstance) {
    return serverInstance;
  }

  const app = express();
  const port = Number(process.env.KEEP_ALIVE_PORT || process.env.PORT || 3000);
  const startedAt = new Date();

  app.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/health', (_req, res) => {
    res.status(204).send();
  });

  serverInstance = app.listen(port, () => {
    console.log(`🌐 Keep-alive server listening on port ${port}`);
  });

  serverInstance.on('error', (error) => {
    console.error('Keep-alive server encountered an error:', error);
  });

  return serverInstance;
}

module.exports = { startKeepAlive };
