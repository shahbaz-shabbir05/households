/**
 * Password hashing behind an interface, with the algorithm and its parameters
 * recorded in the stored string. That lets us move to Argon2id later and
 * transparently re-hash each user on their next successful login, without a
 * migration or a forced reset (docs/07).
 *
 * scrypt is used by default because it is an OWASP-approved KDF available in
 * Node's standard library — no native module to build or keep compiling.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * `promisify` cannot pick the right scrypt overload on its own, so the options
 * form is typed explicitly here.
 */
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** OWASP-recommended scrypt parameters (2024 guidance). */
const N = 65_536; // CPU/memory cost
const r = 8;
const p = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
/** scrypt needs roughly 128 * N * r bytes; the default 32 MiB cap is too low for N=65536. */
const MAX_MEMORY = 128 * N * r * 2;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
  /** True when `stored` used older parameters and should be upgraded on next login. */
  needsRehash(stored: string): boolean;
}

export const scryptHasher: PasswordHasher = {
  async hash(password) {
    const salt = randomBytes(SALT_LENGTH);
    const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
      N,
      r,
      p,
      maxmem: MAX_MEMORY,
    });
    return `scrypt$N=${N},r=${r},p=${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
  },

  async verify(password, stored) {
    const parsed = parse(stored);
    if (!parsed) return false;

    const derived = await scrypt(password.normalize('NFKC'), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: 128 * parsed.N * parsed.r * 2,
    });

    // Constant-time: a length-dependent early return would leak information.
    if (derived.length !== parsed.hash.length) return false;
    return timingSafeEqual(derived, parsed.hash);
  },

  needsRehash(stored) {
    const parsed = parse(stored);
    if (!parsed) return true;
    return parsed.N !== N || parsed.r !== r || parsed.p !== p;
  },
};

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parse(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return null;

  const params = Object.fromEntries(
    (parts[1] ?? '').split(',').map((kv) => {
      const [k, v] = kv.split('=');
      return [k ?? '', Number(v)];
    }),
  ) as Record<string, number>;

  if (!params.N || !params.r || !params.p) return null;

  try {
    return {
      N: params.N,
      r: params.r,
      p: params.p,
      salt: Buffer.from(parts[2] ?? '', 'base64'),
      hash: Buffer.from(parts[3] ?? '', 'base64'),
    };
  } catch {
    return null;
  }
}

/**
 * A dummy hash of a random value, verified against when an email does not
 * exist. Without it, a failed login for an unknown address returns noticeably
 * faster than one for a known address — a timing oracle for enumeration
 * (docs/07).
 */
let dummyHash: string | null = null;
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= await scryptHasher.hash(randomBytes(24).toString('hex'));
  await scryptHasher.verify(password, dummyHash);
}
