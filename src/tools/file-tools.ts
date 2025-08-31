// File Management Tools

import { DirectusClient } from '../client/directus-client.js';
import { logger } from '../utils/logger.js';
import { QueryOptions, UploadOptions } from '../types/directus.js';
import fs from 'fs';
import path from 'path';

export class FileTools {
  constructor(private client: DirectusClient) {}

  async uploadFile(args: {
    file_path?: string;
    file_data?: string; // base64 encoded
    filename?: string;
    title?: string;
    folder?: string;
    storage?: string;
    metadata?: Record<string, any>;
  }): Promise<any> {
    const operationId = `upload_file_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('upload_file', { ...args, file_data: args.file_data ? '[BASE64_DATA]' : undefined });

      let fileBuffer: Buffer;
      let filename = args.filename;

      if (args.file_path) {
        // Upload from file path
        if (!fs.existsSync(args.file_path)) {
          throw new Error(`File not found: ${args.file_path}`);
        }
        fileBuffer = fs.readFileSync(args.file_path);
        filename = filename || path.basename(args.file_path);
      } else if (args.file_data) {
        // Upload from base64 data
        fileBuffer = Buffer.from(args.file_data, 'base64');
        filename = filename || 'upload';
      } else {
        throw new Error('Either file_path or file_data must be provided');
      }

      const options: UploadOptions = {
        filename,
        title: args.title,
        folder: args.folder,
        storage: args.storage,
        metadata: args.metadata
      };

      const result = await this.client.uploadFile(fileBuffer, options);

      const duration = logger.endTimer(operationId);
      logger.toolEnd('upload_file', duration, true, { 
        fileId: result.id,
        filename: result.filename_download,
        size: result.filesize
      });

      return {
        content: [{
          type: 'text',
          text: `File uploaded successfully:\n\n**ID:** ${result.id}\n**Filename:** ${result.filename_download}\n**Title:** ${result.title || 'No title'}\n**Size:** ${result.filesize ? `${Math.round(result.filesize / 1024)} KB` : 'Unknown'}\n**Type:** ${result.type || 'Unknown'}\n**Storage:** ${result.storage}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('upload_file', error as Error);
      
      return {
        content: [{
          type: 'text',
          text: `Error uploading file: ${(error as Error).message}`
        }]
      };
    }
  }

  async getFiles(args: {
    limit?: number;
    offset?: number;
    filter?: Record<string, any>;
    sort?: string[];
    fields?: string[];
    search?: string;
    folder?: string;
  } = {}): Promise<any> {
    const operationId = `get_files_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_files', args);

      const options: QueryOptions = {
        limit: args.limit || 25,
        offset: args.offset,
        filter: args.filter || {},
        sort: args.sort || ['-uploaded_on'],
        fields: args.fields || ['id', 'filename_download', 'title', 'type', 'filesize', 'uploaded_on', 'folder'],
        search: args.search,
        meta: ['total_count']
      };

      if (args.folder) {
        options.filter!.folder = { _eq: args.folder };
      }

      const response = await this.client.getFiles(options);
      const files = response.data || [];
      const meta = response.meta;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_files', duration, true, { 
        count: files.length,
        total: meta?.total_count
      });

      return {
        content: [{
          type: 'text',
          text: `Files (${files.length}${meta?.total_count ? ` of ${meta.total_count}` : ''}):\n\n${files.map((file: any) => 
            `• **${file.filename_download}** (${file.id})\n  Title: ${file.title || 'No title'}\n  Type: ${file.type || 'Unknown'} | Size: ${file.filesize ? `${Math.round(file.filesize / 1024)} KB` : 'Unknown'}\n  Uploaded: ${file.uploaded_on || 'Unknown'}`
          ).join('\n\n')}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_files', error as Error);
      
      return {
        content: [{
          type: 'text',
          text: `Error getting files: ${(error as Error).message}`
        }]
      };
    }
  }

  async getFile(args: { id: string; fields?: string[] }): Promise<any> {
    const operationId = `get_file_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_file', args);

      const options: QueryOptions = {
        fields: args.fields
      };

      const response = await this.client.get(`/files/${args.id}`, options);
      const file = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_file', duration, true, { fileId: args.id });

      return {
        content: [{
          type: 'text',
          text: `File details:\n\n\`\`\`json\n${JSON.stringify(file, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_file', error as Error, { fileId: args.id });
      
      return {
        content: [{
          type: 'text',
          text: `Error getting file ${args.id}: ${(error as Error).message}`
        }]
      };
    }
  }

  async deleteFile(args: { id: string; confirm?: boolean }): Promise<any> {
    const operationId = `delete_file_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      if (!args.confirm) {
        return {
          content: [{
            type: 'text',
            text: `⚠️ **Warning**: This will permanently delete file ${args.id}.\n\nTo proceed, call this tool again with \`confirm: true\`.`
          }]
        };
      }

      logger.toolStart('delete_file', args);

      await this.client.deleteFile(args.id);

      const duration = logger.endTimer(operationId);
      logger.toolEnd('delete_file', duration, true, { fileId: args.id });

      return {
        content: [{
          type: 'text',
          text: `File ${args.id} has been deleted successfully.`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('delete_file', error as Error, { fileId: args.id });
      
      return {
        content: [{
          type: 'text',
          text: `Error deleting file ${args.id}: ${(error as Error).message}`
        }]
      };
    }
  }

  async createFolder(args: {
    name: string;
    parent?: string;
  }): Promise<any> {
    const operationId = `create_folder_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('create_folder', args);

      const folderData = {
        name: args.name,
        parent: args.parent || null
      };

      const response = await this.client.post('/folders', folderData);
      const folder = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('create_folder', duration, true, { 
        folderId: folder?.id,
        name: args.name
      });

      return {
        content: [{
          type: 'text',
          text: `Folder created successfully:\n\n**Name:** ${folder?.name}\n**ID:** ${folder?.id}\n**Parent:** ${folder?.parent || 'Root'}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('create_folder', error as Error, { name: args.name });
      
      return {
        content: [{
          type: 'text',
          text: `Error creating folder: ${(error as Error).message}`
        }]
      };
    }
  }

  async getFolders(args: {
    limit?: number;
    parent?: string;
  } = {}): Promise<any> {
    const operationId = `get_folders_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_folders', args);

      const options: QueryOptions = {
        limit: args.limit || 50,
        filter: {},
        sort: ['name'],
        meta: ['total_count']
      };

      if (args.parent !== undefined) {
        options.filter!.parent = args.parent ? { _eq: args.parent } : { _null: true };
      }

      const response = await this.client.get('/folders', options);
      const folders = response.data || [];
      const meta = response.meta;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_folders', duration, true, { 
        count: folders.length,
        parent: args.parent
      });

      return {
        content: [{
          type: 'text',
          text: `Folders (${folders.length}${meta?.total_count ? ` of ${meta.total_count}` : ''}):\n\n${folders.map((folder: any) => 
            `• **${folder.name}** (${folder.id})\n  Parent: ${folder.parent || 'Root'}`
          ).join('\n\n')}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_folders', error as Error, { parent: args.parent });
      
      return {
        content: [{
          type: 'text',
          text: `Error getting folders: ${(error as Error).message}`
        }]
      };
    }
  }

  async updateFile(args: {
    id: string;
    data: Record<string, any>;
  }): Promise<any> {
    const operationId = `update_file_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('update_file', args);

      const response = await this.client.patch(`/files/${args.id}`, args.data);
      const file = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('update_file', duration, true, { fileId: args.id });

      return {
        content: [{
          type: 'text',
          text: `File ${args.id} updated successfully:\n\n\`\`\`json\n${JSON.stringify(file, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('update_file', error as Error, { fileId: args.id });
      
      return {
        content: [{
          type: 'text',
          text: `Error updating file ${args.id}: ${(error as Error).message}`
        }]
      };
    }
  }

  async getFileUrl(args: { 
    id: string; 
    transform?: Record<string, any>;
    download?: boolean;
  }): Promise<any> {
    const operationId = `get_file_url_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_file_url', args);

      // Get file details first
      const fileResponse = await this.client.get(`/files/${args.id}`);
      const file = fileResponse.data;

      if (!file) {
        throw new Error(`File ${args.id} not found`);
      }

      // Build URL
      const baseUrl = this.client['config'].url; // Access private config
      let url = `${baseUrl}/assets/${args.id}`;

      const params = new URLSearchParams();
      
      if (args.transform) {
        Object.entries(args.transform).forEach(([key, value]) => {
          params.append(key, String(value));
        });
      }

      if (args.download) {
        params.append('download', '');
      }

      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_file_url', duration, true, { fileId: args.id });

      return {
        content: [{
          type: 'text',
          text: `File URL for "${file.filename_download}":\n\n**Direct URL:** ${url}\n**File Type:** ${file.type || 'Unknown'}\n**Size:** ${file.filesize ? `${Math.round(file.filesize / 1024)} KB` : 'Unknown'}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_file_url', error as Error, { fileId: args.id });
      
      return {
        content: [{
          type: 'text',
          text: `Error getting file URL for ${args.id}: ${(error as Error).message}`
        }]
      };
    }
  }
}
