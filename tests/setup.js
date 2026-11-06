import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// IndexedDB emulation is slower when many test files run in parallel: give async queries more time.
configure({ asyncUtilTimeout: 4000 });
import { db, ALL_TABLES } from '../src/db/db.js';

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await Promise.all(ALL_TABLES.map((t) => db[t].clear()));
});

if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
}
