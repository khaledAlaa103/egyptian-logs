import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
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
