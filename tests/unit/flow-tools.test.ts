// Unit tests for src/tools/flow-tools.ts using the DirectusClient stub.

import { describe, it, expect, beforeEach } from 'vitest';
import { FlowTools } from '../../src/tools/flow-tools.js';
import { makeClientStub, type ClientStub } from '../helpers/stubs.js';
import { FLOWS, OPERATIONS, envelope } from '../helpers/fixtures.js';
import type { DirectusClient } from '../../src/client/directus-client.js';

describe('FlowTools', () => {
  let stub: ClientStub & DirectusClient;
  let tools: FlowTools;

  beforeEach(() => {
    stub = makeClientStub();
    tools = new FlowTools(stub);
  });

  describe('getFlows', () => {
    it('lists flows with default options when called with no args', async () => {
      stub.getFlows.mockResolvedValue(envelope(FLOWS, { total_count: 2 }));

      const result = await tools.getFlows();

      expect(stub.getFlows).toHaveBeenCalledTimes(1);
      const options = stub.getFlows.mock.calls[0][0];
      expect(options.limit).toBe(25);
      expect(options.filter).toEqual({});
      expect(options.fields).toEqual([
        'id',
        'name',
        'status',
        'trigger',
        'description',
        'date_created',
      ]);
      expect(options.meta).toEqual(['total_count']);

      const text = result.content[0].text;
      expect(result.content[0].type).toBe('text');
      expect(text).toContain('Flows (2 of 2)');
      expect(text).toContain('**Notify on publish** (flow-0001)');
      expect(text).toContain('Status: active | Trigger: event');
      expect(text).toContain('Sends a notification when an article is published');
      // FLOWS fixture has no date_created -> fallback branch
      expect(text).toContain('Created: Unknown');
    });

    it('applies the status filter branch and custom limit/fields/filter', async () => {
      stub.getFlows.mockResolvedValue(envelope([FLOWS[0]]));

      const result = await tools.getFlows({
        status: 'active',
        limit: 5,
        fields: ['id', 'name'],
        filter: { name: { _contains: 'Notify' } },
      });

      const options = stub.getFlows.mock.calls[0][0];
      expect(options.limit).toBe(5);
      expect(options.fields).toEqual(['id', 'name']);
      expect(options.filter).toEqual({
        name: { _contains: 'Notify' },
        status: { _eq: 'active' },
      });

      // No meta in response -> no "of N" suffix
      expect(result.content[0].text).toContain('Flows (1)');
      expect(result.content[0].text).not.toContain(' of ');
    });

    it('handles flows missing trigger/description with fallback text and empty data', async () => {
      stub.getFlows.mockResolvedValue(
        envelope([{ id: 'flow-x', name: 'Bare', status: 'active', trigger: null, description: null }])
      );

      const result = await tools.getFlows({});
      const text = result.content[0].text;
      expect(text).toContain('Trigger: Manual');
      expect(text).toContain('Description: No description');
    });

    it('tolerates a response with no data array', async () => {
      stub.getFlows.mockResolvedValue({});

      const result = await tools.getFlows();
      expect(result.content[0].text).toContain('Flows (0)');
    });

    it('returns error text when the client rejects', async () => {
      stub.getFlows.mockRejectedValue(new Error('boom flows'));

      const result = await tools.getFlows();
      expect(result.content[0].text).toContain('Error getting flows: boom flows');
    });
  });

  describe('getFlow', () => {
    it('fetches a flow without operations fields by default', async () => {
      stub.get.mockResolvedValue(envelope(FLOWS[0]));

      const result = await tools.getFlow({ id: 'flow-0001' });

      expect(stub.get).toHaveBeenCalledWith('/flows/flow-0001', {});
      expect(result.content[0].text).toContain('Flow details:');
      expect(result.content[0].text).toContain('"name": "Notify on publish"');
    });

    it('requests operations.* fields when include_operations is true', async () => {
      stub.get.mockResolvedValue(envelope({ ...FLOWS[0], operations: OPERATIONS }));

      const result = await tools.getFlow({ id: 'flow-0001', include_operations: true });

      expect(stub.get).toHaveBeenCalledWith('/flows/flow-0001', {
        fields: ['*', 'operations.*'],
      });
      expect(result.content[0].text).toContain('"key": "send_notification"');
    });

    it('returns error text when the client rejects', async () => {
      stub.get.mockRejectedValue(new Error('not found'));

      const result = await tools.getFlow({ id: 'missing-flow' });
      expect(result.content[0].text).toContain('Error getting flow missing-flow: not found');
    });
  });

  describe('triggerFlow', () => {
    it('triggers a flow with provided data', async () => {
      stub.triggerFlow.mockResolvedValue(envelope({ ok: true }));

      const result = await tools.triggerFlow({ id: 'flow-0001', data: { article: 1 } });

      expect(stub.triggerFlow).toHaveBeenCalledWith('flow-0001', { article: 1 });
      expect(result.content[0].text).toContain('Flow flow-0001 triggered successfully');
      expect(result.content[0].text).toContain('"ok": true');
    });

    it('defaults to an empty payload when data is omitted', async () => {
      stub.triggerFlow.mockResolvedValue(envelope(null));

      const result = await tools.triggerFlow({ id: 'flow-0002' });

      expect(stub.triggerFlow).toHaveBeenCalledWith('flow-0002', {});
      expect(result.content[0].text).toContain('Flow flow-0002 triggered successfully');
    });

    it('returns error text when the client rejects', async () => {
      stub.triggerFlow.mockRejectedValue(new Error('trigger failed'));

      const result = await tools.triggerFlow({ id: 'flow-0001' });
      expect(result.content[0].text).toContain('Error triggering flow flow-0001: trigger failed');
    });
  });

  describe('createFlow', () => {
    it('creates a flow with defaults (status active, no operations)', async () => {
      stub.post.mockResolvedValue(
        envelope({ id: 'flow-new', name: 'My flow', status: 'active', trigger: null })
      );

      const result = await tools.createFlow({ name: 'My flow' });

      expect(stub.post).toHaveBeenCalledWith('/flows', {
        name: 'My flow',
        status: 'active',
        trigger: undefined,
        description: undefined,
        options: undefined,
        operations: undefined,
      });

      const text = result.content[0].text;
      expect(text).toContain('Flow created successfully');
      expect(text).toContain('**Name:** My flow');
      expect(text).toContain('**ID:** flow-new');
      expect(text).toContain('**Status:** active');
      // trigger is null in the created flow -> fallback branch
      expect(text).toContain('**Trigger:** Manual');
    });

    it('passes operations array and explicit fields through in a single post', async () => {
      const operations = [
        { key: 'log_it', type: 'log', position_x: 19, position_y: 1, options: { message: 'hi' } },
      ];
      stub.post.mockResolvedValue(
        envelope({ id: 'flow-ops', name: 'With ops', status: 'inactive', trigger: 'webhook' })
      );

      const result = await tools.createFlow({
        name: 'With ops',
        status: 'inactive',
        trigger: 'webhook',
        description: 'has operations',
        options: { async: true },
        operations,
      });

      expect(stub.post).toHaveBeenCalledTimes(1);
      expect(stub.post).toHaveBeenCalledWith('/flows', {
        name: 'With ops',
        status: 'inactive',
        trigger: 'webhook',
        description: 'has operations',
        options: { async: true },
        operations,
      });
      expect(result.content[0].text).toContain('**Status:** inactive');
      expect(result.content[0].text).toContain('**Trigger:** webhook');
    });

    it('returns error text when the client rejects', async () => {
      stub.post.mockRejectedValue(new Error('create failed'));

      const result = await tools.createFlow({ name: 'Broken' });
      expect(result.content[0].text).toContain('Error creating flow: create failed');
    });
  });

  describe('updateFlow', () => {
    it('patches the flow and echoes the updated payload', async () => {
      stub.patch.mockResolvedValue(envelope({ ...FLOWS[1], status: 'active' }));

      const result = await tools.updateFlow({ id: 'flow-0002', data: { status: 'active' } });

      expect(stub.patch).toHaveBeenCalledWith('/flows/flow-0002', { status: 'active' });
      expect(result.content[0].text).toContain('Flow flow-0002 updated successfully');
      expect(result.content[0].text).toContain('"status": "active"');
    });

    it('returns error text when the client rejects', async () => {
      stub.patch.mockRejectedValue(new Error('update failed'));

      const result = await tools.updateFlow({ id: 'flow-0002', data: { status: 'active' } });
      expect(result.content[0].text).toContain('Error updating flow flow-0002: update failed');
    });
  });

  describe('deleteFlow', () => {
    it('returns a warning and does NOT call the client when confirm is missing', async () => {
      const result = await tools.deleteFlow({ id: 'flow-0001' });

      expect(stub.delete).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('Warning');
      expect(result.content[0].text).toContain('permanently delete flow flow-0001');
      expect(result.content[0].text).toContain('confirm: true');
    });

    it('returns the warning when confirm is explicitly false', async () => {
      const result = await tools.deleteFlow({ id: 'flow-0001', confirm: false });

      expect(stub.delete).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('Warning');
    });

    it('deletes the flow when confirm is true', async () => {
      const result = await tools.deleteFlow({ id: 'flow-0001', confirm: true });

      expect(stub.delete).toHaveBeenCalledWith('/flows/flow-0001');
      expect(result.content[0].text).toContain('Flow flow-0001 has been deleted successfully');
    });

    it('returns error text when the client rejects', async () => {
      stub.delete.mockRejectedValue(new Error('delete failed'));

      const result = await tools.deleteFlow({ id: 'flow-0001', confirm: true });
      expect(result.content[0].text).toContain('Error deleting flow flow-0001: delete failed');
    });
  });

  describe('getOperations', () => {
    it('lists operations with defaults and no flow filter', async () => {
      stub.get.mockResolvedValue(envelope(OPERATIONS, { total_count: 1 }));

      const result = await tools.getOperations();

      expect(stub.get).toHaveBeenCalledWith('/operations', {
        limit: 50,
        filter: {},
        sort: ['position_x', 'position_y'],
        meta: ['total_count'],
      });

      const text = result.content[0].text;
      expect(text).toContain('Operations (1 of 1)');
      // op has no name -> key fallback branch
      expect(text).toContain('**send_notification** (op-0001)');
      expect(text).toContain('Type: notification | Flow: flow-0001');
      expect(text).toContain('Position: (19, 1)');
    });

    it('filters by flow_id and honors a custom limit', async () => {
      stub.get.mockResolvedValue(
        envelope([{ ...OPERATIONS[0], name: 'Send notification' }])
      );

      const result = await tools.getOperations({ flow_id: 'flow-0001', limit: 7 });

      const [path, options] = stub.get.mock.calls[0];
      expect(path).toBe('/operations');
      expect(options.limit).toBe(7);
      expect(options.filter).toEqual({ flow: { _eq: 'flow-0001' } });

      const text = result.content[0].text;
      // No meta -> plain count, and the op has a name -> name branch
      expect(text).toContain('Operations (1)');
      expect(text).toContain('**Send notification** (op-0001)');
    });

    it('tolerates a response with no data array', async () => {
      stub.get.mockResolvedValue({});

      const result = await tools.getOperations({});
      expect(result.content[0].text).toContain('Operations (0)');
    });

    it('returns error text when the client rejects', async () => {
      stub.get.mockRejectedValue(new Error('ops failed'));

      const result = await tools.getOperations({ flow_id: 'flow-0001' });
      expect(result.content[0].text).toContain('Error getting operations: ops failed');
    });
  });
});
