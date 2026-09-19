/**
 * Authentication service (docs/07).
 *
 * Two themes run through this file:
 *  - never confirm whether an email exists (uniform responses + a dummy hash
 *    verification so timing does not give it away);
 *  - never store a usable secret (passwords are KDF hashes, tokens are HMACs).
 */

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '@hms/shared';
import { sessions, userTokens, users } from '../../db/schema/index.js';
import type { Database } from '../../db/client.js';
import { config } from '../../config/index.js';
import { ConflictError, UnauthenticatedError, ValidationError } from '../../core/errors.js';
import { dummyVerify, scryptHasher, type PasswordHasher } from '../../core/password.js';
import { addDaysToNow, addHoursToNow, generateToken, hashToken } from '../../core/tokens.js';
import type { Mailer } from '../../core/mailer.js';

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;
const RESET_TOKEN_HOURS = 1;
const VERIFY_TOKEN_HOURS = 24;
/** `last_seen_at` is refreshed at most this often, to avoid a write per request. */
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Passwords that pass the length rule but are still the first thing an attacker
 * tries. A full HIBP-style list belongs behind a service; this covers the
 * obvious cases without shipping a 100MB file.
 */
const COMMON_PASSWORDS = new Set([
  'password123', 'passw0rd123', '1234567890', '12345678901', 'qwertyuiop',
  'iloveyou123', 'welcome123', 'admin12345', 'letmein123', 'password1234',
  'abcd123456', 'qwerty12345',
]);

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  emailVerifiedAt: Date | null;
}

export interface AuthResult {
  user: SessionUser;
  sessionToken: string;
  expiresAt: Date;
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly mailer: Mailer,
    private readonly hasher: PasswordHasher = scryptHasher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async register(input: RegisterInput, meta: RequestMeta): Promise<AuthResult | null> {
    this.assertPasswordAcceptable(input.password);

    const existing = await this.db.query.users.findFirst({
      where: sql`lower(${users.email}) = ${input.email}`,
      columns: { id: true, email: true },
    });

    if (existing) {
      // Do not reveal that the address is taken. Tell the owner of the address
      // instead, which is both safer and more useful to them (docs/07).
      await this.mailer.send({
        to: input.email,
        subject: 'Someone tried to sign up with your email',
        text:
          'Someone tried to create a Home Management System account with this address. ' +
          'If it was you, sign in instead, or reset your password if you have forgotten it.',
      });
      return null;
    }

    const passwordHash = await this.hasher.hash(input.password);
    const [user] = await this.db
      .insert(users)
      .values({ email: input.email, passwordHash, displayName: input.displayName })
      .returning();

    await this.sendVerificationEmail(user!.id, user!.email);
    return this.startSession(toSessionUser(user!), meta);
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.db.query.users.findFirst({
      where: sql`lower(${users.email}) = ${input.email}`,
    });

    if (!user) {
      // Spend comparable time so an unknown address is not detectably faster.
      await dummyVerify(input.password);
      throw new UnauthenticatedError('Email or password is incorrect');
    }

    const now = this.now();
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new UnauthenticatedError(
        'Too many failed attempts. Try again in a few minutes, or reset your password.',
      );
    }

    if (user.anonymizedAt) {
      await dummyVerify(input.password);
      throw new UnauthenticatedError('Email or password is incorrect');
    }

    const valid = await this.hasher.verify(input.password, user.passwordHash);
    if (!valid) {
      await this.recordFailedLogin(user.id, user.failedLoginCount);
      throw new UnauthenticatedError('Email or password is incorrect');
    }

    // Transparent upgrade if the KDF parameters have since been strengthened.
    const patch: Record<string, unknown> = {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: now,
    };
    if (this.hasher.needsRehash(user.passwordHash)) {
      patch.passwordHash = await this.hasher.hash(input.password);
    }
    await this.db.update(users).set(patch).where(eq(users.id, user.id));

    return this.startSession(toSessionUser(user), meta);
  }

  /** Resolves a session token to its user, sliding the expiry as it goes. */
  async resolveSession(token: string): Promise<SessionUser | null> {
    const tokenHash = hashToken(token);
    const now = this.now();

    const row = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
      .limit(1)
      .then((rows) => rows[0]);

    if (!row || row.user.anonymizedAt) return null;

    if (now.getTime() - row.session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
      await this.db
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt: addDaysToNow(config().SESSION_TTL_DAYS, now) })
        .where(eq(sessions.id, row.session.id));
    }

    return toSessionUser(row.user);
  }

  async logout(token: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: this.now() })
      .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: this.now() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  /**
   * Always resolves successfully, whether or not the address exists — the
   * response must not reveal which (docs/07).
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.db.query.users.findFirst({
      where: sql`lower(${users.email}) = ${email}`,
      columns: { id: true, email: true },
    });
    if (!user) return;

    const token = generateToken();
    await this.db.insert(userTokens).values({
      userId: user.id,
      tokenHash: hashToken(token),
      purpose: 'password_reset',
      expiresAt: addHoursToNow(RESET_TOKEN_HOURS, this.now()),
    });

    await this.mailer.send({
      to: user.email,
      subject: 'Reset your password',
      text:
        `Use this link within ${RESET_TOKEN_HOURS} hour to choose a new password:\n\n` +
        `${config().APP_URL}/reset-password?token=${token}\n\n` +
        'If you did not ask for this, you can ignore this email.',
    });
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    this.assertPasswordAcceptable(input.password);
    const record = await this.consumeToken(input.token, 'password_reset');

    const passwordHash = await this.hasher.hash(input.password);
    await this.db.update(users).set({
      passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
    }).where(eq(users.id, record.userId));

    // Anyone holding a stolen session loses it the moment the password changes.
    await this.revokeAllSessions(record.userId);
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    this.assertPasswordAcceptable(input.newPassword);

    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new UnauthenticatedError();

    if (!(await this.hasher.verify(input.currentPassword, user.passwordHash))) {
      throw new ValidationError('Your current password is not correct', [
        { path: 'currentPassword', message: 'Incorrect password' },
      ]);
    }

    await this.db
      .update(users)
      .set({ passwordHash: await this.hasher.hash(input.newPassword) })
      .where(eq(users.id, userId));
    await this.revokeAllSessions(userId);
  }

  async sendVerificationEmail(userId: string, email: string): Promise<void> {
    const token = generateToken();
    await this.db.insert(userTokens).values({
      userId,
      tokenHash: hashToken(token),
      purpose: 'email_verify',
      expiresAt: addHoursToNow(VERIFY_TOKEN_HOURS, this.now()),
    });

    await this.mailer.send({
      to: email,
      subject: 'Confirm your email address',
      text:
        'Confirm your email address to finish setting up your household:\n\n' +
        `${config().APP_URL}/verify-email?token=${token}`,
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.consumeToken(token, 'email_verify');
    await this.db
      .update(users)
      .set({ emailVerifiedAt: this.now() })
      .where(and(eq(users.id, record.userId), isNull(users.emailVerifiedAt)));
  }

  private async consumeToken(
    token: string,
    purpose: 'email_verify' | 'password_reset',
  ): Promise<{ userId: string }> {
    const now = this.now();
    // Single-use: consuming and checking in one statement closes the race where
    // the same link is opened twice.
    const [record] = await this.db
      .update(userTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(userTokens.tokenHash, hashToken(token)),
          eq(userTokens.purpose, purpose),
          isNull(userTokens.consumedAt),
          gt(userTokens.expiresAt, now),
        ),
      )
      .returning({ userId: userTokens.userId });

    if (!record) {
      throw new ValidationError('That link is invalid or has expired', [
        { path: 'token', message: 'Invalid or expired' },
      ]);
    }
    return record;
  }

  private async startSession(user: SessionUser, meta: RequestMeta): Promise<AuthResult> {
    const token = generateToken();
    const expiresAt = addDaysToNow(config().SESSION_TTL_DAYS, this.now());

    await this.db.insert(sessions).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { user, sessionToken: token, expiresAt };
  }

  private async recordFailedLogin(userId: string, current: number): Promise<void> {
    const next = current + 1;
    const lockedUntil =
      next >= MAX_FAILED_LOGINS
        ? new Date(this.now().getTime() + LOCKOUT_MINUTES * 60_000)
        : null;
    await this.db
      .update(users)
      .set({ failedLoginCount: next, ...(lockedUntil ? { lockedUntil } : {}) })
      .where(eq(users.id, userId));
  }

  private assertPasswordAcceptable(password: string): void {
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
      throw new ValidationError('That password is too common', [
        { path: 'password', message: 'Choose something less guessable' },
      ]);
    }
  }
}

function toSessionUser(user: {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  emailVerifiedAt: Date | null;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}

export function isConflict(error: unknown): error is ConflictError {
  return error instanceof ConflictError;
}
