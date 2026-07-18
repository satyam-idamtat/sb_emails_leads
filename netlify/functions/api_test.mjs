import test from 'node:test';
import assert from 'node:assert/strict';
import { saveDatabase, loadDatabase, assignCompanies, syncUserCompanyIds } from './api.mjs';

test('saveDatabase accepts undefined write results from the blob client', async () => {
  const store = {
    setJSON: async () => undefined
  };

  await assert.doesNotReject(() => saveDatabase(store, { users: [] }, 'etag-1'));
});

test('saveDatabase rejects when the blob client reports a precondition conflict', async () => {
  const store = {
    setJSON: async () => ({ modified: false })
  };

  await assert.rejects(() => saveDatabase(store, { users: [] }, 'etag-1'), /The data changed/);
});

test('loadDatabase handles a missing initial blob without crashing', async () => {
  const store = {
    getWithMetadata: async () => null,
    setJSON: async () => undefined
  };

  const result = await loadDatabase(store);

  assert.ok(result.db);
  assert.ok(Array.isArray(result.db.users));
  assert.ok(Array.isArray(result.db.companies));
});

test('assignCompanies reassigns a company to a new user and updates derived access', () => {
  const db = {
    users: [
      { id: 'user-1', role: 'user', companyIds: [] },
      { id: 'user-2', role: 'user', companyIds: [] }
    ],
    companies: [
      { '#': 1, assigned_user_id: 'user-1' },
      { '#': 2, assigned_user_id: 'user-1' }
    ]
  };

  assignCompanies(db, [1], 'user-2');
  syncUserCompanyIds(db);

  assert.equal(db.companies[0].assigned_user_id, 'user-2');
  assert.equal(db.users[0].companyIds.includes('1'), false);
  assert.equal(db.users[1].companyIds.includes('1'), true);
});
