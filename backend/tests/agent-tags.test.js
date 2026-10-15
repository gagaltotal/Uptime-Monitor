const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');

process.env.MONGO_URI = 'mongodb://localhost:27017/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);
process.env.NODE_ENV = 'test';

const { validate } = require(path.join(SRC, 'validators/index.js'));

const results = [];
const check = (name, cond) => results.push([name, !!cond]);

function runValidation(schemaName, body) {
  const req = { body, params: {} };
  const res = {};
  let nextErr = null;
  const next = (err) => { nextErr = err; };
  validate(schemaName)(req, res, next);
  return { req, nextErr };
}

const agentPayload = {
  name: 'Server API',
  description: 'prod',
  hostname: 'api-01',
  distro: 'Ubuntu',
  ipAddress: '10.0.0.5',
  tags: [' prod ', 'api', '', 'prod'],
  interval: 60,
  isActive: true,
};

const monitorPayload = {
  name: 'Website utama',
  type: 'http',
  url: 'https://example.com',
  interval: 60,
  timeout: 10,
  retries: 1,
  tags: [' prod ', 'web', '', 'web'],
  isActive: true,
};

const agentResult = runValidation('agent', agentPayload);
check('agent tags normalisasi & dedupe', JSON.stringify(agentResult.req.body.tags) === JSON.stringify(['prod', 'api']));
check('agent validation tidak error', !agentResult.nextErr);

const monitorResult = runValidation('monitor', monitorPayload);
check('monitor tags normalisasi & dedupe', JSON.stringify(monitorResult.req.body.tags) === JSON.stringify(['prod', 'web']));
check('monitor validation tidak error', !monitorResult.nextErr);

console.log('');
let pass = 0;
for (const [name, ok] of results) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (ok) pass += 1;
}
console.log(`\n${pass}/${results.length} lolos`);
process.exit(pass === results.length ? 0 : 1);
