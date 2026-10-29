import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * Testing Library only auto-cleans when Vitest globals are enabled. Globals are
 * off here (explicit imports read better), so unmounting between tests has to
 * be wired up — without it, renders accumulate and queries match elements left
 * behind by earlier tests.
 */
afterEach(cleanup);
