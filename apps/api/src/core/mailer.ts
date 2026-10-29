/**
 * Transactional email (verification, password reset, invites).
 *
 * Deliberately a tiny interface: the product must not be coupled to a
 * provider (docs/09). The console driver keeps local development and tests
 * fully exercised without a network call — and, importantly, without silently
 * emailing real people from a test database.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export function createConsoleMailer(
  log: (meta: Record<string, unknown>, message: string) => void,
): Mailer {
  return {
    async send(mail) {
      log({ to: mail.to, subject: mail.subject, body: mail.text }, 'email.send (console driver)');
    },
  };
}

/** Collects mail in memory so tests can assert on what would have been sent. */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];

  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }

  lastTo(email: string): Mail | undefined {
    return [...this.sent].reverse().find((m) => m.to === email);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
