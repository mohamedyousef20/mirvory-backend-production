// No database or network writes. Controller dependencies are replaced in memory.
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/user.model.js';
import { login, refreshToken, logout } from '../controllers/user.controller.js';
process.env.JWT_SECRET = 'unit-test-access-secret';
process.env.REFRESH_SECRET = 'unit-test-refresh-secret';
delete process.env.JWT_REFRESH_EXPIRE;
const account = { _id: '507f1f77bcf86cd799439011', role: 'admin', isActive: true, refreshTokens: [], password: await bcrypt.hash('test-only', 4), save: async () => {} };
User.findOne = () => ({ select: async () => account });
User.findById = () => ({ select: async () => account });
User.findByIdAndUpdate = async (id, update) => {
  assert.equal(String(id), account._id);
  account.refreshTokens = account.refreshTokens.filter(t => t.token !== update.$pull.refreshTokens.token);
};
async function call(handler, req) {
  let body, error, status;
  const res = { cookie() { return this; }, status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  await handler(req, res, e => { error = e; });
  return { body, error, status };
}
const signedIn = await call(login, { body: { email: 'local-test', password: 'test-only' } });
assert.equal(signedIn.status, 200);
const token = signedIn.body.tokens.refreshToken;
const payload = jwt.verify(token, process.env.REFRESH_SECRET);
assert.equal(payload.exp - payload.iat, 7 * 86400);
assert(account.refreshTokens[0].expiresAt > new Date());
const req = { cookies: { refreshToken: token } };
const responses = await Promise.all(Array.from({ length: 5 }, () => call(refreshToken, req)));
for (const r of responses) {
  assert.equal(r.status, 200);
  assert.equal(r.body.refreshToken, token);
  assert.equal(jwt.verify(r.body.accessToken, process.env.JWT_SECRET).role, 'admin');
}
account.isActive = false;
assert((await call(refreshToken, req)).error);
account.isActive = true;
account.refreshTokens[0].expiresAt = new Date(0);
assert((await call(refreshToken, req)).error);
account.refreshTokens[0].expiresAt = new Date(Date.now() + 100000);
await call(logout, req);
assert.equal(account.refreshTokens.length, 0);
assert((await call(refreshToken, req)).error);
assert((await call(refreshToken, { cookies: {} })).error);
assert((await call(refreshToken, { cookies: { refreshToken: 'bad' } })).error);
console.log('PASS: login secret/default lifetime, five parallel renewals, access signature/role, inactive/stored-expired/revoked/missing/malformed refresh rejection, logout revocation. No network or DB writes.');
