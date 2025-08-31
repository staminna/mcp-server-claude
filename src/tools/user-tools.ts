// User and Role Management Tools

import { DirectusClient } from '../client/directus-client.js';
import { logger } from '../utils/logger.js';
import { QueryOptions } from '../types/directus.js';

export class UserTools {
  constructor(private client: DirectusClient) {}

  async getUsers(args: {
    limit?: number;
    offset?: number;
    filter?: Record<string, any>;
    fields?: string[];
    search?: string;
  } = {}): Promise<any> {
    const operationId = `get_users_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_users', args);

      const options: QueryOptions = {
        limit: args.limit || 25,
        offset: args.offset,
        filter: args.filter,
        fields: args.fields || ['id', 'first_name', 'last_name', 'email', 'status', 'role', 'last_access'],
        search: args.search,
        meta: ['total_count']
      };

      const response = await this.client.getUsers(options);
      const users = response.data || [];
      const meta = response.meta;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_users', duration, true, { 
        count: users.length,
        total: meta?.total_count
      });

      return {
        content: [{
          type: 'text',
          text: `Users (${users.length}${meta?.total_count ? ` of ${meta.total_count}` : ''}):\n\n${users.map((user: any) => 
            `• **${user.first_name || ''} ${user.last_name || ''}** (${user.email})\n  Status: ${user.status} | Role: ${user.role || 'No role'} | Last Access: ${user.last_access || 'Never'}`
          ).join('\n\n')}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_users', error as Error);
      
      return {
        content: [{
          type: 'text',
          text: `Error getting users: ${(error as Error).message}`
        }]
      };
    }
  }

  async getUser(args: { id: string; fields?: string[] }): Promise<any> {
    const operationId = `get_user_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_user', args);

      const options: QueryOptions = {
        fields: args.fields
      };

      const response = await this.client.getUser(args.id, options);
      const user = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_user', duration, true, { userId: args.id });

      return {
        content: [{
          type: 'text',
          text: `User details:\n\n\`\`\`json\n${JSON.stringify(user, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_user', error as Error, { userId: args.id });
      
      return {
        content: [{
          type: 'text',
          text: `Error getting user ${args.id}: ${(error as Error).message}`
        }]
      };
    }
  }

  async createUser(args: {
    email: string;
    password: string;
    first_name?: string;
    last_name?: string;
    role?: string;
    status?: 'active' | 'invited' | 'draft' | 'suspended';
    [key: string]: any;
  }): Promise<any> {
    const operationId = `create_user_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('create_user', { ...args, password: '[REDACTED]' });

      const userData = {
        email: args.email,
        password: args.password,
        first_name: args.first_name,
        last_name: args.last_name,
        role: args.role,
        status: args.status || 'active',
        ...Object.fromEntries(
          Object.entries(args).filter(([key]) => 
            !['email', 'password', 'first_name', 'last_name', 'role', 'status'].includes(key)
          )
        )
      };

      const response = await this.client.createUser(userData);
      const user = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('create_user', duration, true, { 
        userId: user?.id,
        email: args.email
      });

      return {
        content: [{
          type: 'text',
          text: `User created successfully:\n\n**Name:** ${user?.first_name || ''} ${user?.last_name || ''}\n**Email:** ${user?.email}\n**ID:** ${user?.id}\n**Status:** ${user?.status}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('create_user', error as Error, { email: args.email });
      
      return {
        content: [{
          type: 'text',
          text: `Error creating user: ${(error as Error).message}`
        }]
      };
    }
  }

  async updateUser(args: {
    id: string;
    data: Record<string, any>;
  }): Promise<any> {
    const operationId = `update_user_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('update_user', args);

      const response = await this.client.updateUser(args.id, args.data);
      const user = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('update_user', duration, true, { userId: args.id });

      return {
        content: [{
          type: 'text',
          text: `User ${args.id} updated successfully:\n\n\`\`\`json\n${JSON.stringify(user, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('update_user', error as Error, { userId: args.id });
      
      return {
        content: [{
          type: 'text',
          text: `Error updating user ${args.id}: ${(error as Error).message}`
        }]
      };
    }
  }

  async deleteUser(args: { id: string; confirm?: boolean }): Promise<any> {
    const operationId = `delete_user_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      if (!args.confirm) {
        return {
          content: [{
            type: 'text',
            text: `⚠️ **Warning**: This will permanently delete user ${args.id}.\n\nTo proceed, call this tool again with \`confirm: true\`.`
          }]
        };
      }

      logger.toolStart('delete_user', args);

      await this.client.deleteUser(args.id);

      const duration = logger.endTimer(operationId);
      logger.toolEnd('delete_user', duration, true, { userId: args.id });

      return {
        content: [{
          type: 'text',
          text: `User ${args.id} has been deleted successfully.`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('delete_user', error as Error, { userId: args.id });
      
      return {
        content: [{
          type: 'text',
          text: `Error deleting user ${args.id}: ${(error as Error).message}`
        }]
      };
    }
  }

  async getRoles(args: {
    limit?: number;
    fields?: string[];
  } = {}): Promise<any> {
    const operationId = `get_roles_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_roles', args);

      const options: QueryOptions = {
        limit: args.limit || 50,
        fields: args.fields || ['id', 'name', 'description', 'admin_access', 'app_access'],
        meta: ['total_count']
      };

      const response = await this.client.getRoles(options);
      const roles = response.data || [];
      const meta = response.meta;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_roles', duration, true, { 
        count: roles.length,
        total: meta?.total_count
      });

      return {
        content: [{
          type: 'text',
          text: `Roles (${roles.length}${meta?.total_count ? ` of ${meta.total_count}` : ''}):\n\n${roles.map((role: any) => 
            `• **${role.name}** (${role.id})\n  ${role.description || 'No description'}\n  Admin: ${role.admin_access ? 'Yes' : 'No'} | App Access: ${role.app_access ? 'Yes' : 'No'}`
          ).join('\n\n')}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_roles', error as Error);
      
      return {
        content: [{
          type: 'text',
          text: `Error getting roles: ${(error as Error).message}`
        }]
      };
    }
  }

  async getRole(args: { id: string }): Promise<any> {
    const operationId = `get_role_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_role', args);

      const response = await this.client.getRole(args.id);
      const role = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_role', duration, true, { roleId: args.id });

      return {
        content: [{
          type: 'text',
          text: `Role details:\n\n\`\`\`json\n${JSON.stringify(role, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_role', error as Error, { roleId: args.id });
      
      return {
        content: [{
          type: 'text',
          text: `Error getting role ${args.id}: ${(error as Error).message}`
        }]
      };
    }
  }

  async createRole(args: {
    name: string;
    description?: string;
    admin_access?: boolean;
    app_access?: boolean;
    [key: string]: any;
  }): Promise<any> {
    const operationId = `create_role_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('create_role', args);

      const roleData = {
        name: args.name,
        description: args.description,
        admin_access: args.admin_access || false,
        app_access: args.app_access !== false, // Default to true
        ...Object.fromEntries(
          Object.entries(args).filter(([key]) => 
            !['name', 'description', 'admin_access', 'app_access'].includes(key)
          )
        )
      };

      const response = await this.client.createRole(roleData);
      const role = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('create_role', duration, true, { 
        roleId: role?.id,
        name: args.name
      });

      return {
        content: [{
          type: 'text',
          text: `Role created successfully:\n\n**Name:** ${role?.name}\n**ID:** ${role?.id}\n**Admin Access:** ${role?.admin_access ? 'Yes' : 'No'}\n**App Access:** ${role?.app_access ? 'Yes' : 'No'}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('create_role', error as Error, { name: args.name });
      
      return {
        content: [{
          type: 'text',
          text: `Error creating role: ${(error as Error).message}`
        }]
      };
    }
  }

  async getPermissions(args: {
    role?: string;
    collection?: string;
    limit?: number;
  } = {}): Promise<any> {
    const operationId = `get_permissions_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_permissions', args);

      const options: QueryOptions = {
        limit: args.limit || 100,
        filter: {}
      };

      if (args.role) {
        options.filter!.role = { _eq: args.role };
      }
      if (args.collection) {
        options.filter!.collection = { _eq: args.collection };
      }

      const response = await this.client.getPermissions(options);
      const permissions = response.data || [];

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_permissions', duration, true, { 
        count: permissions.length,
        role: args.role,
        collection: args.collection
      });

      return {
        content: [{
          type: 'text',
          text: `Permissions (${permissions.length}):\n\n${permissions.map((perm: any) => 
            `• **${perm.collection}** - ${perm.action}\n  Role: ${perm.role || 'Public'}\n  Fields: ${perm.fields?.join(', ') || 'All'}`
          ).join('\n\n')}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_permissions', error as Error, { 
        role: args.role,
        collection: args.collection
      });
      
      return {
        content: [{
          type: 'text',
          text: `Error getting permissions: ${(error as Error).message}`
        }]
      };
    }
  }

  async createPermission(args: {
    role: string;
    collection: string;
    action: 'create' | 'read' | 'update' | 'delete' | 'comment' | 'explain';
    permissions?: Record<string, any>;
    validation?: Record<string, any>;
    fields?: string[];
  }): Promise<any> {
    const operationId = `create_permission_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('create_permission', args);

      const permissionData = {
        role: args.role,
        collection: args.collection,
        action: args.action,
        permissions: args.permissions,
        validation: args.validation,
        fields: args.fields
      };

      const response = await this.client.createPermission(permissionData);
      const permission = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('create_permission', duration, true, { 
        role: args.role,
        collection: args.collection,
        action: args.action
      });

      return {
        content: [{
          type: 'text',
          text: `Permission created successfully:\n\n**Role:** ${permission?.role}\n**Collection:** ${permission?.collection}\n**Action:** ${permission?.action}\n**Fields:** ${permission?.fields?.join(', ') || 'All'}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('create_permission', error as Error, { 
        role: args.role,
        collection: args.collection,
        action: args.action
      });
      
      return {
        content: [{
          type: 'text',
          text: `Error creating permission: ${(error as Error).message}`
        }]
      };
    }
  }
}
