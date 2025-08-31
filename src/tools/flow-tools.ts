// Flow and Automation Tools

import { DirectusClient } from '../client/directus-client.js';
import { logger } from '../utils/logger.js';
import { QueryOptions } from '../types/directus.js';

export class FlowTools {
  constructor(private client: DirectusClient) {}

  async getFlows(args: {
    limit?: number;
    filter?: Record<string, any>;
    fields?: string[];
    status?: 'active' | 'inactive';
  } = {}): Promise<any> {
    const operationId = `get_flows_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_flows', args);

      const options: QueryOptions = {
        limit: args.limit || 25,
        filter: args.filter || {},
        fields: args.fields || ['id', 'name', 'status', 'trigger', 'description', 'date_created'],
        meta: ['total_count']
      };

      if (args.status) {
        options.filter!.status = { _eq: args.status };
      }

      const response = await this.client.getFlows(options);
      const flows = response.data || [];
      const meta = response.meta;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_flows', duration, true, { 
        count: flows.length,
        total: meta?.total_count
      });

      return {
        content: [{
          type: 'text',
          text: `Flows (${flows.length}${meta?.total_count ? ` of ${meta.total_count}` : ''}):\n\n${flows.map((flow: any) => 
            `• **${flow.name}** (${flow.id})\n  Status: ${flow.status} | Trigger: ${flow.trigger || 'Manual'}\n  Description: ${flow.description || 'No description'}\n  Created: ${flow.date_created || 'Unknown'}`
          ).join('\n\n')}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_flows', error as Error);
      
      return {
        content: [{
          type: 'text',
          text: `Error getting flows: ${(error as Error).message}`
        }]
      };
    }
  }

  async getFlow(args: { id: string; include_operations?: boolean }): Promise<any> {
    const operationId = `get_flow_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_flow', args);

      const options: QueryOptions = {};
      
      if (args.include_operations) {
        options.fields = ['*', 'operations.*'];
      }

      const response = await this.client.get(`/flows/${args.id}`, options);
      const flow = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_flow', duration, true, { flowId: args.id });

      return {
        content: [{
          type: 'text',
          text: `Flow details:\n\n\`\`\`json\n${JSON.stringify(flow, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_flow', error as Error, { flowId: args.id });
      
      return {
        content: [{
          type: 'text',
          text: `Error getting flow ${args.id}: ${(error as Error).message}`
        }]
      };
    }
  }

  async triggerFlow(args: {
    id: string;
    data?: Record<string, any>;
  }): Promise<any> {
    const operationId = `trigger_flow_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('trigger_flow', args);

      const response = await this.client.triggerFlow(args.id, args.data || {});
      const result = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('trigger_flow', duration, true, { flowId: args.id });

      return {
        content: [{
          type: 'text',
          text: `Flow ${args.id} triggered successfully:\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('trigger_flow', error as Error, { flowId: args.id });
      
      return {
        content: [{
          type: 'text',
          text: `Error triggering flow ${args.id}: ${(error as Error).message}`
        }]
      };
    }
  }

  async createFlow(args: {
    name: string;
    status?: 'active' | 'inactive';
    trigger?: string;
    description?: string;
    options?: Record<string, any>;
    operations?: Array<{
      name?: string;
      key: string;
      type: string;
      position_x: number;
      position_y: number;
      options?: Record<string, any>;
    }>;
  }): Promise<any> {
    const operationId = `create_flow_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('create_flow', args);

      const flowData = {
        name: args.name,
        status: args.status || 'active',
        trigger: args.trigger,
        description: args.description,
        options: args.options,
        operations: args.operations
      };

      const response = await this.client.post('/flows', flowData);
      const flow = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('create_flow', duration, true, { 
        flowId: flow?.id,
        name: args.name
      });

      return {
        content: [{
          type: 'text',
          text: `Flow created successfully:\n\n**Name:** ${flow?.name}\n**ID:** ${flow?.id}\n**Status:** ${flow?.status}\n**Trigger:** ${flow?.trigger || 'Manual'}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('create_flow', error as Error, { name: args.name });
      
      return {
        content: [{
          type: 'text',
          text: `Error creating flow: ${(error as Error).message}`
        }]
      };
    }
  }

  async updateFlow(args: {
    id: string;
    data: Record<string, any>;
  }): Promise<any> {
    const operationId = `update_flow_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('update_flow', args);

      const response = await this.client.patch(`/flows/${args.id}`, args.data);
      const flow = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('update_flow', duration, true, { flowId: args.id });

      return {
        content: [{
          type: 'text',
          text: `Flow ${args.id} updated successfully:\n\n\`\`\`json\n${JSON.stringify(flow, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('update_flow', error as Error, { flowId: args.id });
      
      return {
        content: [{
          type: 'text',
          text: `Error updating flow ${args.id}: ${(error as Error).message}`
        }]
      };
    }
  }

  async deleteFlow(args: { id: string; confirm?: boolean }): Promise<any> {
    const operationId = `delete_flow_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      if (!args.confirm) {
        return {
          content: [{
            type: 'text',
            text: `⚠️ **Warning**: This will permanently delete flow ${args.id} and all its operations.\n\nTo proceed, call this tool again with \`confirm: true\`.`
          }]
        };
      }

      logger.toolStart('delete_flow', args);

      await this.client.delete(`/flows/${args.id}`);

      const duration = logger.endTimer(operationId);
      logger.toolEnd('delete_flow', duration, true, { flowId: args.id });

      return {
        content: [{
          type: 'text',
          text: `Flow ${args.id} has been deleted successfully.`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('delete_flow', error as Error, { flowId: args.id });
      
      return {
        content: [{
          type: 'text',
          text: `Error deleting flow ${args.id}: ${(error as Error).message}`
        }]
      };
    }
  }

  async getOperations(args: {
    flow_id?: string;
    limit?: number;
  } = {}): Promise<any> {
    const operationId = `get_operations_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_operations', args);

      const options: QueryOptions = {
        limit: args.limit || 50,
        filter: {},
        sort: ['position_x', 'position_y'],
        meta: ['total_count']
      };

      if (args.flow_id) {
        options.filter!.flow = { _eq: args.flow_id };
      }

      const response = await this.client.get('/operations', options);
      const operations = response.data || [];
      const meta = response.meta;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_operations', duration, true, { 
        count: operations.length,
        flowId: args.flow_id
      });

      return {
        content: [{
          type: 'text',
          text: `Operations (${operations.length}${meta?.total_count ? ` of ${meta.total_count}` : ''}):\n\n${operations.map((op: any) => 
            `• **${op.name || op.key}** (${op.id})\n  Type: ${op.type} | Flow: ${op.flow}\n  Position: (${op.position_x}, ${op.position_y})`
          ).join('\n\n')}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_operations', error as Error, { flowId: args.flow_id });
      
      return {
        content: [{
          type: 'text',
          text: `Error getting operations: ${(error as Error).message}`
        }]
      };
    }
  }
}
