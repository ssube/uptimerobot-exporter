const { createServer } = require('http');
const { request } = require('https');
const promClient = require('prom-client');
const qs = require('querystring');

const MILLIS_TO_SECONDS = 1000;

const config = {
  endpoint: process.env['UPTIME_ENDPOINT'] || 'api.uptimerobot.com',
  key: process.env['UPTIME_KEY'] || 'app key required',
  interval: parseInt(process.env['UPTIME_INTERVAL'] || '600000', 10),
  port: parseInt(process.env['UPTIME_PORT'] || '3000', 10),
};

function apiRequest(method, path, params = {}) {
  return new Promise((res, rej) => {
    const req = request({
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "cache-control": "no-cache"
      },
      hostname: config.endpoint,
      method,
      port: null,
      path,
    }, (resp) => {
      const chunks = [];

      resp.on('data', (chunk) => {
        chunks.push(chunk);
      });

      resp.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        res(JSON.parse(body));
      });

      resp.on('error', (err) => {
        rej(err);
      });
    });

    req.write(qs.stringify({
      api_key: config.key,
      format: 'json',
      ...params,
    }));
    req.end();
  });
}

const registry = new promClient.Registry();
promClient.collectDefaultMetrics({
  register: registry,
});

const metrics = {
  responseLast: new promClient.Gauge({
    name: 'uptimerobot_response_last_seconds',
    help: 'last measured response time',
    labelNames: ['id', 'name'],
    registers: [registry],
  }),
  responseAvg: new promClient.Gauge({
    name: 'uptimerobot_response_avg_seconds',
    help: 'running average response time',
    labelNames: ['id', 'name'],
    registers: [registry],
  }),
  status: new promClient.Gauge({
    name: 'uptimerobot_status',
    help: 'monitor status',
    labelNames: ['id', 'name'],
    registers: [registry],
  }),
};

function collectMonitors() {
  apiRequest('POST', '/v2/getMonitors', {
    response_times: '1',
    response_times_limit: '1',
  }).then((data) => {
    console.log('listed monitors', data.monitors.length);

    for (const monitor of data.monitors) {
      const labels = {
        id: monitor.id,
        name: monitor.friendly_name,
      };

      const avgMillis = parseFloat(monitor.average_response_time, 10)
      metrics.responseAvg.set(labels, avgMillis / MILLIS_TO_SECONDS);
      metrics.status.set(labels, monitor.status);

      if (monitor.response_times.length > 0) {
        const last = monitor.response_times[monitor.response_times.length - 1];
        const lastMillis = parseFloat(last.value, 10);
        metrics.responseLast.set(labels, lastMillis / MILLIS_TO_SECONDS);
      }
    }
  }).catch((err) => {
    console.error('error listing monitors', err);
  });
}

function collectMetrics() {
  console.log('collecting metrics');

  collectMonitors();
}

function serveMetrics(req, res) {
  console.log('serving metrics');
  registry.metrics().then((data) => {
    res.end(data);
  });
}

const server = createServer(serveMetrics);
server.listen(config.port, () => {
  console.log('server listening');
});

const collector = setInterval(collectMetrics, config.interval);
collectMetrics();

function stop() {
  console.log('closing');
  clearInterval(collector);
  server.close();
}

// on signal, clear interval and close server
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
