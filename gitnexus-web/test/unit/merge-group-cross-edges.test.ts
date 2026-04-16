import type { GraphNode } from 'gitnexus-shared';
import { describe, expect, it } from 'vitest';
import {
  mergeGroupCrossEdges,
  type CrossGroupDetailItem,
  type RepoCrossEdgeDto,
} from '../../src/lib/merge-group-cross-edges.js';

const baseEdge = (): RepoCrossEdgeDto => ({
  groupName: 'test-group',
  contractId: 'http::GET::/api/users/{param}',
  matchType: 'exact',
  kind: 'used_by',
  localSymbolUid: '',
  localLabel: '',
  localFilePath: 'src/routes/users.ts',
  localSymbolName: '',
  remoteRepoName: 'test-frontend',
  remoteGroupPath: 'app/frontend',
  remoteSymbolUid: 'fn-1',
  remoteLabel: 'fetchUser',
});

describe('mergeGroupCrossEdges', () => {
  it('aggregates multiple contracts into one RemoteSymbol per remote service', () => {
    const nodes: GraphNode[] = [
      {
        id: 'Route:/api/users/:id',
        label: 'Route',
        properties: { name: '/api/users/:id', filePath: 'src/routes/users.ts' },
      },
      {
        id: 'Route:/api/users',
        label: 'Route',
        properties: { name: '/api/users', filePath: 'src/routes/users.ts' },
      },
    ];
    const e1 = baseEdge();
    const e2 = baseEdge();
    e2.contractId = 'http::POST::/api/users';
    e2.remoteLabel = 'createUser';

    const merged = mergeGroupCrossEdges(nodes, [], [e1, e2]);

    const remoteNodes = merged.nodes.filter((n) => n.label === 'RemoteSymbol');
    expect(remoteNodes).toHaveLength(1);
    const raw = remoteNodes[0]?.properties?.crossGroupDetailJson;
    expect(typeof raw).toBe('string');
    const details = JSON.parse(String(raw)) as CrossGroupDetailItem[];
    expect(details).toHaveLength(2);
    expect(merged.relationships.filter((r) => r.type === 'CROSS_GROUP')).toHaveLength(1);
  });

  it('anchors used_by to Route when contract path matches Express :param style', () => {
    const nodes: GraphNode[] = [
      {
        id: 'Route:/api/users/:id',
        label: 'Route',
        properties: { name: '/api/users/:id', filePath: 'src/routes/users.ts' },
      },
    ];
    const merged = mergeGroupCrossEdges(nodes, [], [baseEdge()]);

    expect(merged.relationships.filter((r) => r.type === 'CROSS_GROUP')).toHaveLength(1);
    expect(merged.relationships[0]?.sourceId).toBe('Route:/api/users/:id');
    expect(merged.nodes.filter((n) => n.label === 'RemoteSymbol')).toHaveLength(1);
  });

  it('prefers Project as edge source when present', () => {
    const nodes: GraphNode[] = [
      {
        id: 'Project:myapp',
        label: 'Project',
        properties: { name: 'myapp', filePath: '' },
      },
      {
        id: 'Route:/api/users/:id',
        label: 'Route',
        properties: { name: '/api/users/:id', filePath: 'src/routes/users.ts' },
      },
    ];
    const merged = mergeGroupCrossEdges(nodes, [], [baseEdge()]);
    expect(merged.relationships[0]?.sourceId).toBe('Project:myapp');
  });

  it('anchors when Route id casing differs from normalized contract path', () => {
    const nodes: GraphNode[] = [
      {
        id: 'Route:/API/Users',
        label: 'Route',
        properties: { name: '/API/Users', filePath: 'src/routes/users.ts' },
      },
    ];
    const edge = baseEdge();
    edge.contractId = 'http::GET::/api/users';

    const merged = mergeGroupCrossEdges(nodes, [], [edge]);
    expect(merged.relationships.some((r) => r.type === 'CROSS_GROUP')).toBe(true);
  });

  it('anchors used_by via route-in-file when contract path is a suffix (mount / prefix drift)', () => {
    const nodes: GraphNode[] = [
      {
        id: 'Route:/users',
        label: 'Route',
        properties: { name: '/users', filePath: 'src/routes/users.ts' },
      },
    ];
    const edge = baseEdge();
    edge.contractId = 'http::GET::/api/users';

    const merged = mergeGroupCrossEdges(nodes, [], [edge]);
    expect(merged.relationships[0]?.sourceId).toBe('Route:/users');
  });

  it('anchors manifest / non-http edges to File when symbol ref is empty', () => {
    const nodes: GraphNode[] = [
      {
        id: 'File:src/routes/users.ts',
        label: 'File',
        properties: { name: 'users.ts', filePath: 'src/routes/users.ts' },
      },
    ];
    const edge = baseEdge();
    edge.contractId = 'lib::shared-users';
    edge.localSymbolName = '';

    const merged = mergeGroupCrossEdges(nodes, [], [edge]);
    expect(merged.relationships.some((r) => r.type === 'CROSS_GROUP')).toBe(true);
    expect(merged.relationships[0]?.sourceId).toBe('File:src/routes/users.ts');
  });

  it('anchors used_by to sole Function when symbol name is handler (Express source_scan)', () => {
    const nodes: GraphNode[] = [
      {
        id: 'Function:src/routes/users.ts#getUsers#1',
        label: 'Function',
        properties: { name: 'getUsers', filePath: 'src/routes/users.ts' },
      },
    ];
    const edge = baseEdge();
    edge.localSymbolName = 'handler';
    edge.contractId = 'http::GET::/other/path';

    const merged = mergeGroupCrossEdges(nodes, [], [edge]);
    expect(merged.relationships[0]?.sourceId).toBe('Function:src/routes/users.ts#getUsers#1');
  });
});
