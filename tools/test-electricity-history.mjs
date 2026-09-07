// Run with: node tools/test-electricity-history.mjs (Node 22.13+).
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const temporary = await mkdtemp(join(tmpdir(), 'nexus-usage-test-'));
const originalFetch = globalThis.fetch;
try {
  for (const name of ['eloverblik', 'eloverblik-credentials', 'cache']) {
    const source = await readFile(new URL(`../worker/sources/${name}.ts`, import.meta.url), 'utf8');
    const output = stripTypeScriptTypes(source).replace(/from "\.\/(.*?)"/g, 'from "./$1.mjs"');
    await writeFile(join(temporary, name + '.mjs'), output);
  }
  const { parseDays, validUsageRange, getElectricityUsage } = await import(pathToFileURL(join(temporary, 'eloverblik.mjs')));
  const { setEloverblikCredentials } = await import(pathToFileURL(join(temporary, 'eloverblik-credentials.mjs')));
  const point = (position, quantity, quality = 'A04') => ({ position: String(position), 'out_Quantity.quantity': quantity, 'out_Quantity.quality': quality });
  const payload = (start, points) => ({ result: [{ success: true, MyEnergyData_MarketDocument: { TimeSeries: [{ 'measurement_Unit.name': 'KWH', Period: [{ resolution: 'P1D', timeInterval: { start }, Point: points }] }] } }] });
  assert.deepEqual(parseDays(payload('2026-03-27T23:00:00Z', [point(1, '10'), point(2, '11'), point(3, '12')])), [
    { date: '2026-03-28', kwh: 10 }, { date: '2026-03-29', kwh: 11 }, { date: '2026-03-30', kwh: 12 },
  ]);
  assert.deepEqual(parseDays(payload('2025-10-24T22:00:00Z', [point(1, '10'), point(2, '11'), point(3, '12')] )).map(x => x.date), ['2025-10-25','2025-10-26','2025-10-27']);
  assert.deepEqual(parseDays(payload('2026-07-01T22:00:00Z', [point(1, null), point(2, ''), point(3, '0'), point(4, '99', 'A02'), point(5, '99', 'A05'), point(6, '12', 'A03')])), [{ date:'2026-07-04', kwh:0 }, { date:'2026-07-07', kwh:12 }]);
  assert.throws(() => parseDays({result: [{success:false}]}));
  assert.throws(() => parseDays({error:'failure'}));
  assert.equal(validUsageRange('2024-02-29', '2024-03-01'), true);
  for (const range of [['2025-02-29','2025-03-01'],['2024-01-01','2025-01-02'],['2024-01-02','2024-01-01'],['2024-01-01','2024-01-01'],['2024-01-01','2999-01-01'],['bad','2025-01-01']]) assert.equal(validUsageRange(...range),false);

  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES (\'a\'),(\'b\');');
  for (const migration of ['0003_source_cache.sql','0028_eloverblik_user_credentials.sql','0032_electricity_usage_history.sql']) sqlite.exec(await readFile(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
  function prepare(sql) {
    let bindings = [];
    return {
      bind(...args) { bindings = args; return this; },
      async first() { return sqlite.prepare(sql).get(...bindings) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
      async run() { return sqlite.prepare(sql).run(...bindings); },
    };
  }
  const env = { DB: { prepare, batch: async statements => { for (const statement of statements) await statement.run(); } }, ELOVERBLIK_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString('base64') };
  let tokenCalls = 0, usageCalls = 0, fail = false;
  let source = payload('2025-12-31T23:00:00Z', [point(1,'10'),point(2,'20'),point(3,'0')]);
  globalThis.fetch = async url => {
    if (String(url).endsWith('/Token')) { tokenCalls++; return Response.json({result:'synthetic-access-token-for-tests'}); }
    usageCalls++;
    assert.ok(String(url).endsWith('/Day'));
    if (fail) return new Response('', {status:503});
    return Response.json(source);
  };
  const credentials = {refreshToken:'synthetic-refresh', meteringPoint:'meter-1'};
  const range = {from:'2026-01-01',to:'2026-01-04'};
  const first = await getElectricityUsage(env,'a',credentials,range);
  assert.deepEqual(first.data.days.map(x=>x.kwh),[10,20,0]);
  await getElectricityUsage(env,'a',credentials,range);
  await getElectricityUsage(env,'a',credentials,{from:'2026-01-02',to:'2026-01-04'});
  assert.equal(usageCalls,1,'cached/overlapping requests should not hit source');
  const encrypted = sqlite.prepare("SELECT payload_json FROM source_cache WHERE source_key='energy:access:a'").get().payload_json;
  assert.ok(!encrypted.includes('synthetic-access-token'),'access token must not be plaintext');
  const expire = () => sqlite.exec("UPDATE source_cache SET expires_at='2000-01-01' WHERE source_key LIKE 'energy:usage:%'; UPDATE electricity_usage_days SET fetched_at='2000-01-01';");
  expire();
  source = payload('2026-01-01T23:00:00Z',[point(1,'25'),point(2,null,'A02')]);
  const corrected = await getElectricityUsage(env,'a',credentials,range);
  assert.deepEqual(corrected.data.days.map(x=>x.kwh),[10,25,0],'corrections update while missing data preserves history');
  assert.equal(corrected.stale,true,'retained old measurements must be marked');
  assert.equal((await getElectricityUsage(env,'a',credentials,range)).stale,true);
  assert.equal(tokenCalls,1,'period requests reuse encrypted token');
  expire(); fail = true;
  assert.deepEqual((await getElectricityUsage(env,'a',credentials,{from:'2025-12-31',to:'2026-01-04'})).data.days.map(x=>x.kwh),[10,25,0]);
  await assert.rejects(getElectricityUsage(env,'b',credentials,range));
  await assert.rejects(getElectricityUsage(env,'a',{...credentials,meteringPoint:'meter-2'},range));
  await setEloverblikCredentials(env,'a',{...credentials,refreshToken:'new-synthetic-token'});
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM source_cache WHERE source_key LIKE 'energy:usage:v2:a:%' OR source_key='energy:access:a'").get().n,0);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM electricity_usage_days WHERE user_id='a'").get().n,3,'changing credentials retains history');
  sqlite.exec('DROP TABLE electricity_usage_days');
  fail = false;
  assert.equal((await getElectricityUsage(env,'a',credentials,range)).data.days.length,1,'source views work before migration');
  const callsBefore = usageCalls;
  await getElectricityUsage(env,'a',credentials,range);
  assert.equal(usageCalls,callsBefore,'pre-migration requests use cache');
  sqlite.exec(await readFile(new URL('../migrations/0032_electricity_usage_history.sql', import.meta.url), 'utf8'));
  await getElectricityUsage(env,'a',credentials,range);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM electricity_usage_days').get().n,1,'migration enables persistence despite temporary cache');
  sqlite.close();
  console.log('PASS: local dates/DST, missing/zero/estimated data, bounds, SQL persistence/corrections, cache reuse, encrypted tokens, source failure, user/meter isolation, credential invalidation.');
} finally {
  globalThis.fetch = originalFetch;
  await rm(temporary, {recursive:true,force:true});
}
