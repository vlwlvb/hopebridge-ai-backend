import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const serverPath = path.join(projectRoot, 'server.js');
const envExamplePath = path.join(projectRoot, '.env.example');
const serverSource = fs.readFileSync(serverPath, 'utf8');
const envExample = fs.readFileSync(envExamplePath, 'utf8');
const errors = [];
const checks = [];

function check(condition, okMessage, failMessage) {
  if (condition) checks.push(`PASS: ${okMessage}`);
  else errors.push(`FAIL: ${failMessage}`);
}

try {
  execFileSync('node', ['--check', serverPath], { stdio: 'pipe' });
  checks.push('PASS: server.js syntax is valid.');
} catch (error) {
  errors.push(`FAIL: server.js syntax is invalid: ${String(error.stderr || error.message || error)}`);
}

check(packageJson.version === '1.4.2', 'backend package.json version is 1.4.2.', 'backend package.json version is not 1.4.2.');
check(serverSource.includes("const APP_VERSION = 'v14.2.0';"), 'backend app version constant is aligned.', 'APP_VERSION is missing or outdated in server.js.');
check(serverSource.includes("app.disable('x-powered-by');"), 'x-powered-by header is disabled.', 'x-powered-by header is not disabled.');
check(serverSource.includes("res.setHeader('Cache-Control', 'no-store');"), 'no-store response headers are enabled.', 'no-store response headers are missing.');
check(serverSource.includes("app.post('/chat-support'"), 'chat-support endpoint is present.', 'chat-support endpoint is missing.');
check(serverSource.includes("app.get('/health'"), 'health endpoint is present.', 'health endpoint is missing.');
check(!/OPENAI_API_KEY=sk-/i.test(envExample), '.env.example does not contain a real OpenAI key.', '.env.example still contains a real OpenAI key.');

if (errors.length) {
  console.error('HopeBridge backend preflight failed.');
  for (const item of checks) console.log(item);
  for (const item of errors) console.error(item);
  process.exit(1);
}

console.log('HopeBridge backend preflight passed.');
for (const item of checks) console.log(item);
