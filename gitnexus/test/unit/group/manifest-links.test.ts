import { describe, it, expect } from 'vitest';
import type { GroupManifestLink, StoredContract, CrossLink } from '../../../src/core/group/types.js';
import {
  consumerProviderRepos,
  manifestContractId,
  manifestLinksToCrossLinks,
  mergeManifestWithExact,
} from '../../../src/core/group/manifest-links.js';

describe('manifestContractId', () => {
  it('prefixes type when contract omits type', () => {
    const link: GroupManifestLink = {
      from: 'a',
      to: 'b',
      type: 'http',
      contract: 'GET::/api/users',
      role: 'consumer',
    };
    expect(manifestContractId(link)).toBe('http::GET::/api/users');
  });

  it('normalizes full http id (trailing slash strip)', () => {
    const link: GroupManifestLink = {
      from: 'a',
      to: 'b',
      type: 'http',
      contract: 'http::GET::/api/users/',
      role: 'consumer',
    };
    expect(manifestContractId(link)).toBe('http::GET::/api/users');
  });
});

describe('consumerProviderRepos', () => {
  it('keeps from→to when role is consumer', () => {
    const link: GroupManifestLink = {
      from: 'app/fe',
      to: 'app/be',
      type: 'http',
      contract: 'GET::/x',
      role: 'consumer',
    };
    expect(consumerProviderRepos(link)).toEqual({ consumer: 'app/fe', provider: 'app/be' });
  });

  it('swaps when role is provider (consumer is to)', () => {
    const link: GroupManifestLink = {
      from: 'app/be',
      to: 'app/fe',
      type: 'http',
      contract: 'GET::/x',
      role: 'provider',
    };
    expect(consumerProviderRepos(link)).toEqual({ consumer: 'app/fe', provider: 'app/be' });
  });
});

describe('manifestLinksToCrossLinks', () => {
  const baseLink: GroupManifestLink = {
    from: 'app/frontend',
    to: 'app/backend',
    type: 'http',
    contract: 'GET::/api/users',
    role: 'consumer',
  };

  it('fills symbol uids when contracts exist', () => {
    const contracts: StoredContract[] = [
      {
        contractId: 'http::GET::/api/users',
        type: 'http',
        role: 'consumer',
        symbolUid: 'c1',
        symbolRef: { filePath: 'src/api.ts', name: 'fetch' },
        symbolName: 'fetch',
        confidence: 0.9,
        meta: {},
        repo: 'app/frontend',
      },
      {
        contractId: 'http::GET::/api/users',
        type: 'http',
        role: 'provider',
        symbolUid: 'p1',
        symbolRef: { filePath: 'src/routes.ts', name: 'list' },
        symbolName: 'list',
        confidence: 0.9,
        meta: {},
        repo: 'app/backend',
      },
    ];
    const out = manifestLinksToCrossLinks([baseLink], contracts);
    expect(out).toHaveLength(1);
    expect(out[0].matchType).toBe('manifest');
    expect(out[0].from.symbolUid).toBe('c1');
    expect(out[0].to.symbolUid).toBe('p1');
    expect(out[0].from.repo).toBe('app/frontend');
    expect(out[0].to.repo).toBe('app/backend');
  });

  it('emits link with empty uids when no matching contracts', () => {
    const out = manifestLinksToCrossLinks([baseLink], []);
    expect(out).toHaveLength(1);
    expect(out[0].from.symbolUid).toBe('');
    expect(out[0].to.symbolUid).toBe('');
    expect(out[0].contractId).toBe('http::GET::/api/users');
  });

  it('dedupes duplicate manifest declarations', () => {
    const out = manifestLinksToCrossLinks([baseLink, baseLink], []);
    expect(out).toHaveLength(1);
  });
});

describe('mergeManifestWithExact', () => {
  const exact: CrossLink[] = [
    {
      from: {
        repo: 'app/frontend',
        symbolUid: 'c',
        symbolRef: { filePath: 'a.ts', name: 'x' },
      },
      to: {
        repo: 'app/backend',
        symbolUid: 'p',
        symbolRef: { filePath: 'b.ts', name: 'y' },
      },
      type: 'http',
      contractId: 'http::GET::/api/users',
      matchType: 'exact',
      confidence: 1,
    },
  ];

  it('drops manifest when exact covers same triple', () => {
    const manifest: CrossLink[] = [
      {
        from: {
          repo: 'app/frontend',
          symbolUid: '',
          symbolRef: { filePath: '', name: '' },
        },
        to: {
          repo: 'app/backend',
          symbolUid: '',
          symbolRef: { filePath: '', name: '' },
        },
        type: 'http',
        contractId: 'http::GET::/api/users',
        matchType: 'manifest',
        confidence: 1,
      },
    ];
    const merged = mergeManifestWithExact(exact, manifest);
    expect(merged).toHaveLength(1);
    expect(merged[0].matchType).toBe('exact');
  });

  it('keeps manifest when no exact triple', () => {
    const manifest: CrossLink[] = [
      {
        from: {
          repo: 'app/frontend',
          symbolUid: '',
          symbolRef: { filePath: '', name: '' },
        },
        to: {
          repo: 'app/other',
          symbolUid: '',
          symbolRef: { filePath: '', name: '' },
        },
        type: 'http',
        contractId: 'http::GET::/api/other',
        matchType: 'manifest',
        confidence: 1,
      },
    ];
    const merged = mergeManifestWithExact(exact, manifest);
    expect(merged).toHaveLength(2);
  });
});
