import { describe, expect, it } from 'vitest';
import { pathsReferToSameNote } from './path-match';

describe('pathsReferToSameNote', () => {
  it('matches unicode-equivalent paths ignoring leading slashes and case', () => {
    const nfc = 'Tasks/VPN с Ахтырским - Vikunja DevOps.md';
    const nfd = nfc.normalize('NFD');
    expect(pathsReferToSameNote(nfc, nfd)).toBe(true);
    expect(pathsReferToSameNote(`/${nfc}`, nfc)).toBe(true);
    expect(pathsReferToSameNote(nfc.toUpperCase(), nfc)).toBe(true);
  });

  it('does not match different notes', () => {
    expect(pathsReferToSameNote('Tasks/One.md', 'Tasks/Two.md')).toBe(false);
  });
});
