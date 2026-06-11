// Unit tests for src/tools/file-tools.ts using the DirectusClient stub.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import { FileTools } from '../../src/tools/file-tools.js';
import { makeClientStub, type ClientStub } from '../helpers/stubs.js';
import { envelope, FILES, FOLDERS } from '../helpers/fixtures.js';
import type { DirectusClient } from '../../src/client/directus-client.js';

const UPLOAD_FIXTURE = fileURLToPath(new URL('../helpers/files/upload.txt', import.meta.url));

const UPLOAD_RESULT = {
  id: 'file-new',
  filename_download: 'upload.txt',
  title: 'Uploaded',
  filesize: 4096,
  type: 'text/plain',
  storage: 'local',
};

function text(result: any): string {
  return result.content[0].text;
}

describe('FileTools', () => {
  let stub: ClientStub & DirectusClient;
  let tools: FileTools;

  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stub = makeClientStub();
    tools = new FileTools(stub);
    // The logger singleton writes JSON lines to stderr for the catch branches;
    // silence it so test output stays readable.
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe('uploadFile', () => {
    it('uploads from a file_path, deriving the filename from the path', async () => {
      stub.uploadFile.mockResolvedValue(UPLOAD_RESULT);

      const result = await tools.uploadFile({ file_path: UPLOAD_FIXTURE });

      expect(stub.uploadFile).toHaveBeenCalledTimes(1);
      const [buffer, options] = stub.uploadFile.mock.calls[0];
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.equals(fs.readFileSync(UPLOAD_FIXTURE))).toBe(true);
      expect(options).toEqual({
        filename: 'upload.txt',
        title: undefined,
        folder: undefined,
        storage: undefined,
        metadata: undefined,
      });

      const out = text(result);
      expect(out).toContain('File uploaded successfully');
      expect(out).toContain('file-new');
      expect(out).toContain('upload.txt');
      expect(out).toContain('Uploaded');
      expect(out).toContain('4 KB');
      expect(out).toContain('text/plain');
      expect(out).toContain('local');
    });

    it('returns an error when the file_path does not exist', async () => {
      const result = await tools.uploadFile({ file_path: '/definitely/not/here.txt' });

      expect(stub.uploadFile).not.toHaveBeenCalled();
      expect(text(result)).toContain('Error uploading file');
      expect(text(result)).toContain('File not found: /definitely/not/here.txt');
    });

    it('uploads from base64 file_data with a default filename of "upload"', async () => {
      stub.uploadFile.mockResolvedValue({ ...UPLOAD_RESULT, title: undefined, filesize: undefined, type: undefined });
      const payload = Buffer.from('hello base64').toString('base64');

      const result = await tools.uploadFile({ file_data: payload });

      const [buffer, options] = stub.uploadFile.mock.calls[0];
      expect(buffer.toString('utf8')).toBe('hello base64');
      expect(options.filename).toBe('upload');

      const out = text(result);
      expect(out).toContain('File uploaded successfully');
      expect(out).toContain('No title');
      expect(out).toContain('**Size:** Unknown');
      expect(out).toContain('**Type:** Unknown');
    });

    it('passes filename/title/folder/storage/metadata through to the client', async () => {
      stub.uploadFile.mockResolvedValue(UPLOAD_RESULT);

      await tools.uploadFile({
        file_data: Buffer.from('x').toString('base64'),
        filename: 'custom-name.bin',
        title: 'My title',
        folder: 'folder-1',
        storage: 's3',
        metadata: { alt: 'image alt' },
      });

      const [, options] = stub.uploadFile.mock.calls[0];
      expect(options).toEqual({
        filename: 'custom-name.bin',
        title: 'My title',
        folder: 'folder-1',
        storage: 's3',
        metadata: { alt: 'image alt' },
      });
    });

    it('returns an error when neither file_path nor file_data is provided', async () => {
      const result = await tools.uploadFile({});

      expect(stub.uploadFile).not.toHaveBeenCalled();
      expect(text(result)).toContain('Either file_path or file_data must be provided');
    });

    it('returns an error when the client upload fails', async () => {
      stub.uploadFile.mockRejectedValue(new Error('413 Payload Too Large'));

      const result = await tools.uploadFile({ file_path: UPLOAD_FIXTURE });

      expect(text(result)).toContain('Error uploading file: 413 Payload Too Large');
    });
  });

  describe('getFiles', () => {
    it('lists files with default query options', async () => {
      stub.getFiles.mockResolvedValue(envelope(FILES, { total_count: 9 }));

      const result = await tools.getFiles();

      expect(stub.getFiles).toHaveBeenCalledWith({
        limit: 25,
        offset: undefined,
        filter: {},
        sort: ['-uploaded_on'],
        fields: ['id', 'filename_download', 'title', 'type', 'filesize', 'uploaded_on', 'folder'],
        search: undefined,
        meta: ['total_count'],
      });

      const out = text(result);
      expect(out).toContain('Files (2 of 9):');
      expect(out).toContain('photo.jpg');
      expect(out).toContain('doc.pdf');
      expect(out).toContain('file-0001');
      expect(out).toContain('1 KB');
    });

    it('applies the folder filter and custom options', async () => {
      stub.getFiles.mockResolvedValue(envelope([FILES[1]]));

      const result = await tools.getFiles({
        limit: 5,
        offset: 10,
        filter: { type: { _eq: 'application/pdf' } },
        sort: ['title'],
        fields: ['id', 'title'],
        search: 'doc',
        folder: 'folder-1',
      });

      expect(stub.getFiles).toHaveBeenCalledWith({
        limit: 5,
        offset: 10,
        filter: { type: { _eq: 'application/pdf' }, folder: { _eq: 'folder-1' } },
        sort: ['title'],
        fields: ['id', 'title'],
        search: 'doc',
        meta: ['total_count'],
      });
      expect(text(result)).toContain('Files (1):');
    });

    it('renders fallbacks for files without title/type/size/upload date', async () => {
      stub.getFiles.mockResolvedValue(envelope([{ id: 'file-bare', filename_download: 'bare.bin' }]));

      const out = text(await tools.getFiles());
      expect(out).toContain('bare.bin');
      expect(out).toContain('Title: No title');
      expect(out).toContain('Type: Unknown');
      expect(out).toContain('Size: Unknown');
      expect(out).toContain('Uploaded: Unknown');
    });

    it('handles a response without a data array', async () => {
      stub.getFiles.mockResolvedValue({});

      expect(text(await tools.getFiles())).toContain('Files (0):');
    });

    it('returns an error when the client fails', async () => {
      stub.getFiles.mockRejectedValue(new Error('boom'));

      expect(text(await tools.getFiles())).toContain('Error getting files: boom');
    });
  });

  describe('getFile', () => {
    it('returns file details as JSON', async () => {
      stub.get.mockResolvedValue(envelope(FILES[0]));

      const result = await tools.getFile({ id: 'file-0001', fields: ['id', 'title'] });

      expect(stub.get).toHaveBeenCalledWith('/files/file-0001', { fields: ['id', 'title'] });
      const out = text(result);
      expect(out).toContain('File details:');
      expect(out).toContain('"id": "file-0001"');
      expect(out).toContain('"filename_download": "photo.jpg"');
    });

    it('returns an error when the file is not found', async () => {
      stub.get.mockRejectedValue(new Error('Resource not found (404)'));

      const result = await tools.getFile({ id: 'missing' });

      expect(text(result)).toContain('Error getting file missing: Resource not found (404)');
    });
  });

  describe('updateFile', () => {
    it('patches the file and returns the updated record', async () => {
      stub.patch.mockResolvedValue(envelope({ ...FILES[0], title: 'Renamed' }));

      const result = await tools.updateFile({ id: 'file-0001', data: { title: 'Renamed' } });

      expect(stub.patch).toHaveBeenCalledWith('/files/file-0001', { title: 'Renamed' });
      const out = text(result);
      expect(out).toContain('File file-0001 updated successfully');
      expect(out).toContain('"title": "Renamed"');
    });

    it('returns an error when the patch fails', async () => {
      stub.patch.mockRejectedValue(new Error('forbidden'));

      const result = await tools.updateFile({ id: 'file-0001', data: { title: 'X' } });

      expect(text(result)).toContain('Error updating file file-0001: forbidden');
    });
  });

  describe('deleteFile', () => {
    it('returns a warning and does not call the client without confirm', async () => {
      const result = await tools.deleteFile({ id: 'file-0001' });

      expect(stub.deleteFile).not.toHaveBeenCalled();
      const out = text(result);
      expect(out).toContain('Warning');
      expect(out).toContain('permanently delete file file-0001');
      expect(out).toContain('confirm: true');
    });

    it('does not delete when confirm is explicitly false', async () => {
      const result = await tools.deleteFile({ id: 'file-0001', confirm: false });

      expect(stub.deleteFile).not.toHaveBeenCalled();
      expect(text(result)).toContain('Warning');
    });

    it('deletes the file when confirm is true', async () => {
      stub.deleteFile.mockResolvedValue(undefined);

      const result = await tools.deleteFile({ id: 'file-0001', confirm: true });

      expect(stub.deleteFile).toHaveBeenCalledWith('file-0001');
      expect(text(result)).toContain('File file-0001 has been deleted successfully.');
    });

    it('returns an error when the delete fails', async () => {
      stub.deleteFile.mockRejectedValue(new Error('locked'));

      const result = await tools.deleteFile({ id: 'file-0001', confirm: true });

      expect(text(result)).toContain('Error deleting file file-0001: locked');
    });
  });

  describe('createFolder', () => {
    it('creates a folder with a parent', async () => {
      stub.post.mockResolvedValue(envelope({ id: 'folder-2', name: 'Invoices', parent: 'folder-1' }));

      const result = await tools.createFolder({ name: 'Invoices', parent: 'folder-1' });

      expect(stub.post).toHaveBeenCalledWith('/folders', { name: 'Invoices', parent: 'folder-1' });
      const out = text(result);
      expect(out).toContain('Folder created successfully');
      expect(out).toContain('**Name:** Invoices');
      expect(out).toContain('**ID:** folder-2');
      expect(out).toContain('**Parent:** folder-1');
    });

    it('creates a root folder when parent is omitted', async () => {
      stub.post.mockResolvedValue(envelope({ id: 'folder-3', name: 'Root Stuff', parent: null }));

      const result = await tools.createFolder({ name: 'Root Stuff' });

      expect(stub.post).toHaveBeenCalledWith('/folders', { name: 'Root Stuff', parent: null });
      expect(text(result)).toContain('**Parent:** Root');
    });

    it('returns an error when folder creation fails', async () => {
      stub.post.mockRejectedValue(new Error('duplicate name'));

      const result = await tools.createFolder({ name: 'Invoices' });

      expect(text(result)).toContain('Error creating folder: duplicate name');
    });
  });

  describe('getFolders', () => {
    it('lists folders with default options and no parent filter', async () => {
      stub.get.mockResolvedValue(envelope(FOLDERS, { total_count: 3 }));

      const result = await tools.getFolders();

      expect(stub.get).toHaveBeenCalledWith('/folders', {
        limit: 50,
        filter: {},
        sort: ['name'],
        meta: ['total_count'],
      });
      const out = text(result);
      expect(out).toContain('Folders (1 of 3):');
      expect(out).toContain('**Documents** (folder-1)');
      expect(out).toContain('Parent: Root');
    });

    it('filters by parent id when parent is provided', async () => {
      stub.get.mockResolvedValue(envelope([{ id: 'folder-2', name: 'Sub', parent: 'folder-1' }]));

      const result = await tools.getFolders({ limit: 10, parent: 'folder-1' });

      expect(stub.get).toHaveBeenCalledWith('/folders', {
        limit: 10,
        filter: { parent: { _eq: 'folder-1' } },
        sort: ['name'],
        meta: ['total_count'],
      });
      expect(text(result)).toContain('Parent: folder-1');
    });

    it('filters for root folders when parent is an empty string', async () => {
      stub.get.mockResolvedValue(envelope(FOLDERS));

      await tools.getFolders({ parent: '' });

      const [, options] = stub.get.mock.calls[0];
      expect(options.filter).toEqual({ parent: { _null: true } });
    });

    it('handles a response without a data array', async () => {
      stub.get.mockResolvedValue({});

      expect(text(await tools.getFolders())).toContain('Folders (0):');
    });

    it('returns an error when the client fails', async () => {
      stub.get.mockRejectedValue(new Error('nope'));

      expect(text(await tools.getFolders())).toContain('Error getting folders: nope');
    });
  });

  describe('getFileUrl', () => {
    it('builds a plain asset URL from the client config', async () => {
      stub.get.mockResolvedValue(envelope(FILES[0]));

      const result = await tools.getFileUrl({ id: 'file-0001' });

      expect(stub.get).toHaveBeenCalledWith('/files/file-0001');
      const out = text(result);
      expect(out).toContain('File URL for "photo.jpg"');
      expect(out).toContain('**Direct URL:** http://directus.test/assets/file-0001');
      expect(out).not.toContain('assets/file-0001?');
      expect(out).toContain('image/jpeg');
      expect(out).toContain('1 KB');
    });

    it('appends transform parameters to the URL', async () => {
      stub.get.mockResolvedValue(envelope(FILES[0]));

      const result = await tools.getFileUrl({
        id: 'file-0001',
        transform: { width: 300, height: 200, fit: 'cover' },
      });

      expect(text(result)).toContain(
        'http://directus.test/assets/file-0001?width=300&height=200&fit=cover'
      );
    });

    it('appends the download flag', async () => {
      stub.get.mockResolvedValue(envelope(FILES[0]));

      const result = await tools.getFileUrl({ id: 'file-0001', download: true });

      expect(text(result)).toContain('http://directus.test/assets/file-0001?download=');
    });

    it('combines transform and download parameters', async () => {
      stub.get.mockResolvedValue(envelope({ ...FILES[0], type: undefined, filesize: undefined }));

      const result = await tools.getFileUrl({ id: 'file-0001', transform: { quality: 80 }, download: true });

      const out = text(result);
      expect(out).toContain('http://directus.test/assets/file-0001?quality=80&download=');
      expect(out).toContain('**File Type:** Unknown');
      expect(out).toContain('**Size:** Unknown');
    });

    it('returns an error when the file is not found', async () => {
      stub.get.mockResolvedValue(envelope(null));

      const result = await tools.getFileUrl({ id: 'ghost' });

      expect(text(result)).toContain('Error getting file URL for ghost: File ghost not found');
    });

    it('returns an error when the lookup request fails', async () => {
      stub.get.mockRejectedValue(new Error('network down'));

      const result = await tools.getFileUrl({ id: 'file-0001' });

      expect(text(result)).toContain('Error getting file URL for file-0001: network down');
    });
  });
});
