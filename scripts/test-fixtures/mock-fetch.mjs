// Test-only: replaces global fetch with a lookup in the JSON route table at
// $MOCK_FETCH_ROUTES ({ url: { body } | { body64 } | { status } }). Any URL not
// in the table answers 404, like a not-yet-published CMS file.
// Loaded via `node --import` by build-icd10pcs-drg-index.test.mjs.
import fs from 'node:fs';

const routes = JSON.parse(fs.readFileSync(process.env.MOCK_FETCH_ROUTES, 'utf8'));
globalThis.fetch = async (url) => {
  const r = routes[String(url)];
  const status = r ? (r.status || 200) : 404;
  const buf = r && r.body64 ? Buffer.from(r.body64, 'base64') : Buffer.from((r && r.body) || 'Not Found');
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => buf.toString('utf8'),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};
