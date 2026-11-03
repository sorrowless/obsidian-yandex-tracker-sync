import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  createEmptyMapping,
  isMappingBlank,
  isMappingComplete,
  mappingRecencyFilter,
  normalizeMappingPath,
  normalizeRecencyValue,
  normalizeSyncIntervalValue,
  orgIdHeaderName,
  prepareMappingsForSave,
  syncIntervalToMilliseconds,
  type NoteBoardMapping,
} from './settings';

describe('settings helpers', () => {
  it('exposes defaults', () => {
    expect(DEFAULT_SETTINGS.conflictPolicy).toBe('prefer-obsidian');
    expect(DEFAULT_SETTINGS.orgIdHeaderMode).toBe('org');
    expect(DEFAULT_SETTINGS.trackerApiBaseUrl).toBe('https://api.tracker.yandex.net');
    expect(DEFAULT_SETTINGS.trackerSiteBaseUrl).toBe('https://tracker.yandex.ru');
    expect(DEFAULT_SETTINGS.mappings).toEqual([]);
  });

  it('maps org header modes', () => {
    expect(orgIdHeaderName('org')).toBe('X-Org-ID');
    expect(orgIdHeaderName('cloud-org')).toBe('X-Cloud-Org-ID');
  });

  it('clamps sync interval', () => {
    expect(normalizeSyncIntervalValue(0)).toBe(1);
    expect(normalizeSyncIntervalValue(2.9)).toBe(2);
    expect(syncIntervalToMilliseconds(2, 'hours')).toBe(2 * 60 * 60 * 1000);
  });

  it('normalizes mapping paths with NFC and strips leading slashes', () => {
    expect(normalizeMappingPath('/Folder/My tasks.md')).toBe('Folder/My tasks.md');
    const nfd = 'е\u0301';
    expect(normalizeMappingPath(nfd)).toBe(nfd.normalize('NFC'));
  });

  it('detects blank and complete mappings', () => {
    const blank = createEmptyMapping();
    expect(isMappingBlank(blank)).toBe(true);
    expect(isMappingComplete(blank)).toBe(false);
    blank.notePath = 'a.md';
    blank.boardId = 3;
    expect(isMappingComplete(blank)).toBe(true);
  });

  it('prepareMappingsForSave mutates in place and normalizes labels', () => {
    const mappings: NoteBoardMapping[] = [
      {
        notePath: ' /x.md ',
        boardId: 1.8,
        labels: [' Beta ', 'alpha', 'alpha'],
        queueKey: ' doc ',
        recencyValue: -3,
        recencyUnit: 'days',
        recencyField: 'updated',
      },
    ];
    const ref = mappings[0]!;
    prepareMappingsForSave(mappings);
    expect(mappings[0]).toBe(ref);
    expect(ref.notePath).toBe('x.md');
    expect(ref.boardId).toBe(1);
    expect(ref.labels).toEqual(['alpha', 'Beta']);
    expect(ref.queueKey).toBe('DOC');
    expect(ref.recencyValue).toBe(0);
  });

  it('normalizes and builds optional recency filters', () => {
    expect(normalizeRecencyValue(0)).toBe(0);
    expect(normalizeRecencyValue(12.9)).toBe(12);
    expect(
      mappingRecencyFilter({
        recencyValue: 30,
        recencyUnit: 'days',
        recencyField: 'updated',
      }),
    ).toEqual({ field: 'updated', value: 30, unit: 'days' });
    expect(
      mappingRecencyFilter({
        recencyValue: 0,
        recencyUnit: 'months',
        recencyField: 'created',
      }),
    ).toBeNull();
    expect(createEmptyMapping().recencyValue).toBe(0);
  });
});
