import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Agent,
  closeTestApp,
  createTestApp,
  shutdownTestDatabase,
  type TestApp,
} from '../../test/setup.js';
import { TEST_PASSWORD, registerUser, uniqueEmail, verifyEmail } from '../../test/factories.js';

let test: TestApp;

beforeEach(async () => {
  test = await createTestApp();
});
afterEach(async () => {
  await closeTestApp(test);
});
afterAll(async () => {
  await shutdownTestDatabase();
});

describe('POST /auth/register', () => {
  it('creates an account and signs the user in', async () => {
    const agent = new Agent(test.app);
    const email = uniqueEmail();

    const response = await agent.post('/api/v1/auth/register', {
      email,
      password: TEST_PASSWORD,
      displayName: 'Ayesha',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.user.email).toBe(email);
    expect(agent.sessionCookie).toBeTruthy();
  });

  it('sends a verification email but does not block usage on it', async () => {
    const { email, agent } = await registerUser(test);
    expect(test.mailer.lastTo(email)?.subject).toMatch(/confirm your email/i);

    // Unverified, yet the session works — verification gates invites, not use.
    const me = await agent.get('/api/v1/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().data.user.emailVerified).toBe(false);
  });

  it('does not reveal that an email is already registered', async () => {
    const { email } = await registerUser(test);
    test.mailer.clear();

    const second = new Agent(test.app);
    const response = await second.post('/api/v1/auth/register', {
      email,
      password: TEST_PASSWORD,
      displayName: 'Impostor',
    });

    // Same status code as a real signup; no session issued.
    expect(response.statusCode).toBe(201);
    expect(response.json().data.created).toBe(false);
    expect(second.sessionCookie).toBeUndefined();
    // The address owner is told instead.
    expect(test.mailer.lastTo(email)?.subject).toMatch(/tried to sign up/i);
  });

  it('rejects a short password with a field-level error', async () => {
    const agent = new Agent(test.app);
    const response = await agent.post('/api/v1/auth/register', {
      email: uniqueEmail(),
      password: 'short',
      displayName: 'Ayesha',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(response.json().error.details).toContainEqual(
      expect.objectContaining({ path: 'password' }),
    );
  });

  it('rejects a long-but-common password', async () => {
    const agent = new Agent(test.app);
    const response = await agent.post('/api/v1/auth/register', {
      email: uniqueEmail(),
      password: 'password123',
      displayName: 'Ayesha',
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /auth/login', () => {
  it('signs in with correct credentials', async () => {
    const { email } = await registerUser(test);
    const agent = new Agent(test.app);

    const response = await agent.post('/api/v1/auth/login', { email, password: TEST_PASSWORD });
    expect(response.statusCode).toBe(200);
    expect(agent.sessionCookie).toBeTruthy();
  });

  it('gives the same error for a wrong password and an unknown account', async () => {
    const { email } = await registerUser(test);
    const agent = new Agent(test.app);

    const wrongPassword = await agent.post('/api/v1/auth/login', { email, password: 'wrong-password-x' });
    const unknownUser = await agent.post('/api/v1/auth/login', {
      email: uniqueEmail('nobody'),
      password: 'wrong-password-x',
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.json().error.message).toBe(unknownUser.json().error.message);
  });

  it('rate-limits repeated login attempts from one client', async () => {
    const { email } = await registerUser(test);
    const agent = new Agent(test.app);

    const codes: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const response = await agent.post('/api/v1/auth/login', { email, password: `wrong-${i}-aaaa` });
      codes.push(response.statusCode);
    }

    // The per-route limiter is the first line of defence and stops the burst
    // well before the account lockout is reached.
    expect(codes).toContain(429);
  });

  it('locks the account after repeated failures, independently of rate limiting', async () => {
    // Driven through the service so the HTTP rate limiter does not mask the
    // lockout: both defences exist, and each needs its own test (docs/07).
    const { email } = await registerUser(test);
    const meta = { ip: '203.0.113.9', userAgent: 'vitest' };

    for (let i = 0; i < 10; i += 1) {
      await expect(
        test.container.auth.login({ email, password: `wrong-${i}-aaaa` }, meta),
      ).rejects.toThrow();
    }

    // Even the correct password is refused while the lock holds.
    await expect(
      test.container.auth.login({ email, password: TEST_PASSWORD }, meta),
    ).rejects.toThrow(/too many failed attempts/i);
  });
});

describe('sessions', () => {
  it('rejects requests with no session', async () => {
    const response = await new Agent(test.app).get('/api/v1/me');
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('invalidates the session on logout', async () => {
    const { agent } = await registerUser(test);
    expect((await agent.get('/api/v1/me')).statusCode).toBe(200);

    await agent.post('/api/v1/auth/logout');
    expect((await agent.get('/api/v1/me')).statusCode).toBe(401);
  });

  it('revokes every session when the password changes', async () => {
    const { email, agent } = await registerUser(test);

    // A second device.
    const other = new Agent(test.app);
    await other.post('/api/v1/auth/login', { email, password: TEST_PASSWORD });
    expect((await other.get('/api/v1/me')).statusCode).toBe(200);

    await agent.post('/api/v1/auth/password/change', {
      currentPassword: TEST_PASSWORD,
      newPassword: 'a-completely-different-passphrase',
    });

    // This is the point of server-side sessions: revocation is immediate.
    expect((await other.get('/api/v1/me')).statusCode).toBe(401);
  });
});

describe('CSRF', () => {
  it('rejects a state-changing request without the CSRF header', async () => {
    const { agent } = await registerUser(test);

    const response = await agent.post('/api/v1/households', { name: 'No CSRF' }, { csrf: false });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toMatch(/csrf/i);
  });

  it('allows reads without a CSRF header', async () => {
    const { agent } = await registerUser(test);
    const response = await agent.request('GET', '/api/v1/me', undefined, { csrf: false });
    expect(response.statusCode).toBe(200);
  });
});

describe('password reset', () => {
  it('resets the password and revokes existing sessions', async () => {
    const { email, agent } = await registerUser(test);
    const newPassword = 'another-good-long-passphrase';

    const requested = await new Agent(test.app).post('/api/v1/auth/password/forgot', { email });
    expect(requested.statusCode).toBe(200);

    const token = /token=([\w-]+)/.exec(test.mailer.lastTo(email)?.text ?? '')?.[1];
    expect(token).toBeTruthy();

    const reset = await new Agent(test.app).post('/api/v1/auth/password/reset', {
      token,
      password: newPassword,
    });
    expect(reset.statusCode).toBe(200);

    expect((await agent.get('/api/v1/me')).statusCode).toBe(401);

    const fresh = new Agent(test.app);
    expect(
      (await fresh.post('/api/v1/auth/login', { email, password: newPassword })).statusCode,
    ).toBe(200);
  });

  it('refuses to reuse a reset token', async () => {
    const { email } = await registerUser(test);
    await new Agent(test.app).post('/api/v1/auth/password/forgot', { email });
    const token = /token=([\w-]+)/.exec(test.mailer.lastTo(email)?.text ?? '')?.[1];

    const first = await new Agent(test.app).post('/api/v1/auth/password/reset', {
      token,
      password: 'first-new-passphrase',
    });
    const second = await new Agent(test.app).post('/api/v1/auth/password/reset', {
      token,
      password: 'second-new-passphrase',
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(400);
  });

  it('responds identically for an unknown address', async () => {
    const response = await new Agent(test.app).post('/api/v1/auth/password/forgot', {
      email: uniqueEmail('nobody'),
    });
    expect(response.statusCode).toBe(200);
    expect(test.mailer.sent).toHaveLength(0);
  });
});

describe('email verification', () => {
  it('marks the address verified', async () => {
    const { email, agent } = await registerUser(test);
    await verifyEmail(test, email, agent);

    const me = await agent.get('/api/v1/me');
    expect(me.json().data.user.emailVerified).toBe(true);
  });
});
