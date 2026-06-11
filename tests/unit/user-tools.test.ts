// Unit tests for UserTools (src/tools/user-tools.ts)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UserTools } from '../../src/tools/user-tools.js';
import { logger } from '../../src/utils/logger.js';
import { makeClientStub } from '../helpers/stubs.js';
import { envelope, USERS, ROLES, PERMISSIONS } from '../helpers/fixtures.js';

function text(result: any): string {
  return result.content[0].text;
}

describe('UserTools', () => {
  let stub: ReturnType<typeof makeClientStub>;
  let tools: UserTools;

  beforeEach(() => {
    stub = makeClientStub();
    tools = new UserTools(stub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------- getUsers
  describe('getUsers', () => {
    it('lists users with default options', async () => {
      stub.getUsers.mockResolvedValue(envelope(USERS, { total_count: 7 }));

      const result = await tools.getUsers();

      expect(stub.getUsers).toHaveBeenCalledTimes(1);
      const options = stub.getUsers.mock.calls[0][0];
      expect(options.limit).toBe(25);
      expect(options.offset).toBeUndefined();
      expect(options.filter).toBeUndefined();
      expect(options.fields).toEqual([
        'id', 'first_name', 'last_name', 'email', 'status', 'role', 'last_access',
      ]);
      expect(options.meta).toEqual(['total_count']);

      const out = text(result);
      expect(out).toContain('Users (2 of 7)');
      expect(out).toContain('Ada Lovelace');
      expect(out).toContain('ada@example.com');
      expect(out).toContain('Role: role-admin');
      // USERS fixture has no last_access
      expect(out).toContain('Last Access: Never');
    });

    it('passes filter/limit/offset/fields/search through to the client', async () => {
      stub.getUsers.mockResolvedValue(envelope(USERS));

      await tools.getUsers({
        limit: 3,
        offset: 10,
        filter: { status: { _eq: 'active' } },
        fields: ['id', 'email'],
        search: 'ada',
      });

      const options = stub.getUsers.mock.calls[0][0];
      expect(options.limit).toBe(3);
      expect(options.offset).toBe(10);
      expect(options.filter).toEqual({ status: { _eq: 'active' } });
      expect(options.fields).toEqual(['id', 'email']);
      expect(options.search).toBe('ada');
    });

    it('renders fallbacks for missing name, role and meta', async () => {
      stub.getUsers.mockResolvedValue(
        envelope([{ id: 'cccc-3333', email: 'anon@example.com', status: 'invited' }])
      );

      const result = await tools.getUsers();
      const out = text(result);

      // No "of N" suffix when meta is absent
      expect(out).toContain('Users (1):');
      expect(out).toContain('(anon@example.com)');
      expect(out).toContain('Role: No role');
      expect(out).toContain('Last Access: Never');
    });

    it('handles a response without a data array', async () => {
      stub.getUsers.mockResolvedValue({});

      const result = await tools.getUsers();
      expect(text(result)).toContain('Users (0)');
    });

    it('returns an error message when the client rejects', async () => {
      stub.getUsers.mockRejectedValue(new Error('users blew up'));

      const result = await tools.getUsers();
      expect(text(result)).toContain('Error getting users: users blew up');
    });
  });

  // ----------------------------------------------------------------- getUser
  describe('getUser', () => {
    it('returns a single user as JSON', async () => {
      stub.getUser.mockResolvedValue(envelope(USERS[0]));

      const result = await tools.getUser({ id: 'aaaa-1111' });

      expect(stub.getUser).toHaveBeenCalledWith('aaaa-1111', { fields: undefined });
      const out = text(result);
      expect(out).toContain('User details:');
      expect(out).toContain('"email": "ada@example.com"');
    });

    it('passes fields through to the client', async () => {
      stub.getUser.mockResolvedValue(envelope(USERS[1]));

      await tools.getUser({ id: 'bbbb-2222', fields: ['id', 'email'] });

      expect(stub.getUser).toHaveBeenCalledWith('bbbb-2222', { fields: ['id', 'email'] });
    });

    it('returns an error message when the client rejects', async () => {
      stub.getUser.mockRejectedValue(new Error('not found'));

      const result = await tools.getUser({ id: 'missing-id' });
      expect(text(result)).toContain('Error getting user missing-id: not found');
    });
  });

  // -------------------------------------------------------------- createUser
  describe('createUser', () => {
    it('creates a user with default status and extra fields', async () => {
      const created = { ...USERS[0], id: 'new-user-1' };
      stub.createUser.mockResolvedValue(envelope(created));

      const result = await tools.createUser({
        email: 'ada@example.com',
        password: 's3cret-pass',
        first_name: 'Ada',
        last_name: 'Lovelace',
        role: 'role-admin',
        custom_field: 'extra-value',
      });

      expect(stub.createUser).toHaveBeenCalledTimes(1);
      const payload = stub.createUser.mock.calls[0][0];
      expect(payload.email).toBe('ada@example.com');
      expect(payload.password).toBe('s3cret-pass');
      expect(payload.status).toBe('active'); // default
      expect(payload.custom_field).toBe('extra-value'); // extra key passthrough

      const out = text(result);
      expect(out).toContain('User created successfully');
      expect(out).toContain('**Email:** ada@example.com');
      expect(out).toContain('**ID:** new-user-1');
    });

    it('redacts the password in the tool-start log', async () => {
      const toolStartSpy = vi.spyOn(logger, 'toolStart');
      const stderrSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      stub.createUser.mockResolvedValue(envelope(USERS[0]));

      await tools.createUser({
        email: 'ada@example.com',
        password: 'super-secret-password-xyz',
      });

      expect(toolStartSpy).toHaveBeenCalledWith(
        'create_user',
        expect.objectContaining({ password: '[REDACTED]' })
      );
      const loggedArgs = toolStartSpy.mock.calls.find((c) => c[0] === 'create_user')![1];
      expect(JSON.stringify(loggedArgs)).not.toContain('super-secret-password-xyz');

      // Nothing written to stderr may contain the clear-text password.
      for (const call of stderrSpy.mock.calls) {
        expect(String(call[0])).not.toContain('super-secret-password-xyz');
      }
    });

    it('uses an explicitly provided status and tolerates missing names', async () => {
      stub.createUser.mockResolvedValue(
        envelope({ id: 'new-user-2', email: 'grace@example.com', status: 'suspended' })
      );

      const result = await tools.createUser({
        email: 'grace@example.com',
        password: 'pw',
        status: 'suspended',
      });

      expect(stub.createUser.mock.calls[0][0].status).toBe('suspended');
      const out = text(result);
      expect(out).toContain('**Status:** suspended');
      expect(out).toContain('**Email:** grace@example.com');
    });

    it('returns an error message when the client rejects', async () => {
      stub.createUser.mockRejectedValue(new Error('email taken'));

      const result = await tools.createUser({ email: 'dup@example.com', password: 'pw' });
      expect(text(result)).toContain('Error creating user: email taken');
    });
  });

  // -------------------------------------------------------------- updateUser
  describe('updateUser', () => {
    it('updates a user and returns the updated JSON', async () => {
      stub.updateUser.mockResolvedValue(envelope({ ...USERS[0], first_name: 'Augusta' }));

      const result = await tools.updateUser({
        id: 'aaaa-1111',
        data: { first_name: 'Augusta' },
      });

      expect(stub.updateUser).toHaveBeenCalledWith('aaaa-1111', { first_name: 'Augusta' });
      const out = text(result);
      expect(out).toContain('User aaaa-1111 updated successfully');
      expect(out).toContain('"first_name": "Augusta"');
    });

    it('returns an error message when the client rejects', async () => {
      stub.updateUser.mockRejectedValue(new Error('forbidden'));

      const result = await tools.updateUser({ id: 'aaaa-1111', data: {} });
      expect(text(result)).toContain('Error updating user aaaa-1111: forbidden');
    });
  });

  // -------------------------------------------------------------- deleteUser
  describe('deleteUser', () => {
    it('returns a warning and does not call the client without confirm', async () => {
      const result = await tools.deleteUser({ id: 'aaaa-1111' });

      expect(stub.deleteUser).not.toHaveBeenCalled();
      const out = text(result);
      expect(out).toContain('Warning');
      expect(out).toContain('permanently delete user aaaa-1111');
      expect(out).toContain('confirm: true');
    });

    it('also warns when confirm is explicitly false', async () => {
      const result = await tools.deleteUser({ id: 'aaaa-1111', confirm: false });

      expect(stub.deleteUser).not.toHaveBeenCalled();
      expect(text(result)).toContain('Warning');
    });

    it('deletes the user when confirm is true', async () => {
      stub.deleteUser.mockResolvedValue(undefined);

      const result = await tools.deleteUser({ id: 'aaaa-1111', confirm: true });

      expect(stub.deleteUser).toHaveBeenCalledWith('aaaa-1111');
      expect(text(result)).toContain('User aaaa-1111 has been deleted successfully.');
    });

    it('returns an error message when the client rejects', async () => {
      stub.deleteUser.mockRejectedValue(new Error('cannot delete admin'));

      const result = await tools.deleteUser({ id: 'aaaa-1111', confirm: true });
      expect(text(result)).toContain('Error deleting user aaaa-1111: cannot delete admin');
    });
  });

  // ---------------------------------------------------------------- getRoles
  describe('getRoles', () => {
    it('lists roles with default options', async () => {
      stub.getRoles.mockResolvedValue(envelope(ROLES, { total_count: 2 }));

      const result = await tools.getRoles();

      const options = stub.getRoles.mock.calls[0][0];
      expect(options.limit).toBe(50);
      expect(options.fields).toEqual(['id', 'name', 'description', 'admin_access', 'app_access']);
      expect(options.meta).toEqual(['total_count']);

      const out = text(result);
      expect(out).toContain('Roles (2 of 2)');
      expect(out).toContain('**Administrator** (role-admin)');
      expect(out).toContain('Admin: Yes');
      expect(out).toContain('Admin: No');
      // ROLES fixtures carry no description and no app_access
      expect(out).toContain('No description');
      expect(out).toContain('App Access: No');
    });

    it('passes limit/fields through and renders description/app access', async () => {
      stub.getRoles.mockResolvedValue(
        envelope([
          {
            id: 'role-x',
            name: 'Custom',
            description: 'A custom role',
            admin_access: false,
            app_access: true,
          },
        ])
      );

      const result = await tools.getRoles({ limit: 5, fields: ['id', 'name'] });

      const options = stub.getRoles.mock.calls[0][0];
      expect(options.limit).toBe(5);
      expect(options.fields).toEqual(['id', 'name']);

      const out = text(result);
      expect(out).toContain('Roles (1):');
      expect(out).toContain('A custom role');
      expect(out).toContain('App Access: Yes');
    });

    it('handles a response without a data array', async () => {
      stub.getRoles.mockResolvedValue({});

      const result = await tools.getRoles();
      expect(text(result)).toContain('Roles (0)');
    });

    it('returns an error message when the client rejects', async () => {
      stub.getRoles.mockRejectedValue(new Error('roles down'));

      const result = await tools.getRoles();
      expect(text(result)).toContain('Error getting roles: roles down');
    });
  });

  // ----------------------------------------------------------------- getRole
  describe('getRole', () => {
    it('returns role details as JSON', async () => {
      stub.getRole.mockResolvedValue(envelope(ROLES[0]));

      const result = await tools.getRole({ id: 'role-admin' });

      expect(stub.getRole).toHaveBeenCalledWith('role-admin');
      const out = text(result);
      expect(out).toContain('Role details:');
      expect(out).toContain('"name": "Administrator"');
    });

    it('returns an error message when the client rejects', async () => {
      stub.getRole.mockRejectedValue(new Error('no such role'));

      const result = await tools.getRole({ id: 'role-zzz' });
      expect(text(result)).toContain('Error getting role role-zzz: no such role');
    });
  });

  // -------------------------------------------------------------- createRole
  describe('createRole', () => {
    it('creates a role with default access flags and extra fields', async () => {
      stub.createRole.mockResolvedValue(
        envelope({ id: 'role-new', name: 'Writers', admin_access: false, app_access: true })
      );

      const result = await tools.createRole({ name: 'Writers', icon: 'edit' });

      const payload = stub.createRole.mock.calls[0][0];
      expect(payload.name).toBe('Writers');
      expect(payload.admin_access).toBe(false); // default
      expect(payload.app_access).toBe(true); // default
      expect(payload.icon).toBe('edit'); // extra key passthrough

      const out = text(result);
      expect(out).toContain('Role created successfully');
      expect(out).toContain('**Name:** Writers');
      expect(out).toContain('**ID:** role-new');
      expect(out).toContain('**Admin Access:** No');
      expect(out).toContain('**App Access:** Yes');
    });

    it('honours explicit admin_access true and app_access false', async () => {
      stub.createRole.mockResolvedValue(
        envelope({ id: 'role-su', name: 'Super', admin_access: true, app_access: false })
      );

      const result = await tools.createRole({
        name: 'Super',
        description: 'Full power',
        admin_access: true,
        app_access: false,
      });

      const payload = stub.createRole.mock.calls[0][0];
      expect(payload.admin_access).toBe(true);
      expect(payload.app_access).toBe(false);
      expect(payload.description).toBe('Full power');

      const out = text(result);
      expect(out).toContain('**Admin Access:** Yes');
      expect(out).toContain('**App Access:** No');
    });

    it('returns an error message when the client rejects', async () => {
      stub.createRole.mockRejectedValue(new Error('duplicate role'));

      const result = await tools.createRole({ name: 'Writers' });
      expect(text(result)).toContain('Error creating role: duplicate role');
    });
  });

  // ----------------------------------------------------------- getPermissions
  describe('getPermissions', () => {
    it('lists permissions with default options and an empty filter', async () => {
      stub.getPermissions.mockResolvedValue(envelope(PERMISSIONS));

      const result = await tools.getPermissions();

      const options = stub.getPermissions.mock.calls[0][0];
      expect(options.limit).toBe(100);
      expect(options.filter).toEqual({});

      const out = text(result);
      expect(out).toContain('Permissions (1):');
      expect(out).toContain('**articles** - read');
      expect(out).toContain('Role: role-editor');
      expect(out).toContain('Fields: All'); // fixture has no fields
    });

    it('builds role and collection filters and renders fields/public role', async () => {
      stub.getPermissions.mockResolvedValue(
        envelope([
          { id: 2, collection: 'articles', action: 'update', role: null, fields: ['title', 'status'] },
        ])
      );

      const result = await tools.getPermissions({
        role: 'role-editor',
        collection: 'articles',
        limit: 10,
      });

      const options = stub.getPermissions.mock.calls[0][0];
      expect(options.limit).toBe(10);
      expect(options.filter).toEqual({
        role: { _eq: 'role-editor' },
        collection: { _eq: 'articles' },
      });

      const out = text(result);
      expect(out).toContain('Role: Public');
      expect(out).toContain('Fields: title, status');
    });

    it('handles a response without a data array', async () => {
      stub.getPermissions.mockResolvedValue({});

      const result = await tools.getPermissions();
      expect(text(result)).toContain('Permissions (0)');
    });

    it('returns an error message when the client rejects', async () => {
      stub.getPermissions.mockRejectedValue(new Error('perm denied'));

      const result = await tools.getPermissions({ role: 'role-x', collection: 'articles' });
      expect(text(result)).toContain('Error getting permissions: perm denied');
    });
  });

  // --------------------------------------------------------- createPermission
  describe('createPermission', () => {
    it('creates a permission with fields', async () => {
      stub.createPermission.mockResolvedValue(
        envelope({
          id: 9,
          role: 'role-editor',
          collection: 'articles',
          action: 'update',
          fields: ['title'],
        })
      );

      const result = await tools.createPermission({
        role: 'role-editor',
        collection: 'articles',
        action: 'update',
        permissions: { status: { _eq: 'draft' } },
        validation: { title: { _nnull: true } },
        fields: ['title'],
      });

      const payload = stub.createPermission.mock.calls[0][0];
      expect(payload).toEqual({
        role: 'role-editor',
        collection: 'articles',
        action: 'update',
        permissions: { status: { _eq: 'draft' } },
        validation: { title: { _nnull: true } },
        fields: ['title'],
      });

      const out = text(result);
      expect(out).toContain('Permission created successfully');
      expect(out).toContain('**Role:** role-editor');
      expect(out).toContain('**Collection:** articles');
      expect(out).toContain('**Action:** update');
      expect(out).toContain('**Fields:** title');
    });

    it('renders "All" when the created permission has no fields', async () => {
      stub.createPermission.mockResolvedValue(
        envelope({ id: 10, role: 'role-editor', collection: 'articles', action: 'read' })
      );

      const result = await tools.createPermission({
        role: 'role-editor',
        collection: 'articles',
        action: 'read',
      });

      expect(text(result)).toContain('**Fields:** All');
    });

    it('returns an error message when the client rejects', async () => {
      stub.createPermission.mockRejectedValue(new Error('invalid action'));

      const result = await tools.createPermission({
        role: 'role-editor',
        collection: 'articles',
        action: 'read',
      });
      expect(text(result)).toContain('Error creating permission: invalid action');
    });
  });
});
