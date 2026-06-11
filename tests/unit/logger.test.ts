import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { Logger, LogLevel, logger, log, logError } from '../../src/utils/logger.js';

describe('logger', () => {
  let stderrSpy: MockInstance;
  let originalLevel: LogLevel;

  /** Parse all JSON lines written to stderr since the spy was installed/cleared. */
  function written(): any[] {
    return stderrSpy.mock.calls.map((call) => JSON.parse(String(call[0]).trim()));
  }

  beforeEach(() => {
    originalLevel = (logger as any).logLevel;
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    logger.setLogLevel(originalLevel);
    vi.unstubAllEnvs();
  });

  describe('getInstance singleton', () => {
    it('returns the same instance on repeated calls', () => {
      const a = Logger.getInstance();
      const b = Logger.getInstance();
      expect(a).toBe(b);
    });

    it('the exported logger binding is the singleton instance', () => {
      expect(Logger.getInstance()).toBe(logger);
    });
  });

  describe('LOG_LEVEL env constructor branch', () => {
    const savedInstance = () => (Logger as any).instance;

    it('reads a valid LOG_LEVEL (case-insensitive) from the environment', () => {
      const original = savedInstance();
      try {
        (Logger as any).instance = undefined;
        vi.stubEnv('LOG_LEVEL', 'debug');
        const fresh = Logger.getInstance();
        expect(fresh).not.toBe(original);
        expect((fresh as any).logLevel).toBe(LogLevel.DEBUG);
      } finally {
        (Logger as any).instance = original;
        vi.unstubAllEnvs();
      }
    });

    it('falls back to INFO when LOG_LEVEL is invalid', () => {
      const original = savedInstance();
      try {
        (Logger as any).instance = undefined;
        vi.stubEnv('LOG_LEVEL', 'TRACE');
        const fresh = Logger.getInstance();
        expect((fresh as any).logLevel).toBe(LogLevel.INFO);
      } finally {
        (Logger as any).instance = original;
        vi.unstubAllEnvs();
      }
    });

    it('falls back to INFO when LOG_LEVEL is unset', () => {
      const original = savedInstance();
      const originalEnv = process.env.LOG_LEVEL;
      try {
        (Logger as any).instance = undefined;
        delete process.env.LOG_LEVEL;
        const fresh = Logger.getInstance();
        expect((fresh as any).logLevel).toBe(LogLevel.INFO);
      } finally {
        (Logger as any).instance = original;
        if (originalEnv !== undefined) process.env.LOG_LEVEL = originalEnv;
      }
    });
  });

  describe('level filtering matrix', () => {
    const callAll = () => {
      logger.debug('d-msg');
      logger.info('i-msg');
      logger.warn('w-msg');
      logger.error('e-msg');
    };

    it('emits all four levels at DEBUG threshold', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      callAll();
      const lines = written();
      expect(lines).toHaveLength(4);
      expect(lines.map((l) => l.level)).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR']);
    });

    it('filters DEBUG at INFO threshold', () => {
      logger.setLogLevel(LogLevel.INFO);
      callAll();
      const lines = written();
      expect(lines).toHaveLength(3);
      expect(lines.map((l) => l.level)).toEqual(['INFO', 'WARN', 'ERROR']);
    });

    it('filters DEBUG and INFO at WARN threshold', () => {
      logger.setLogLevel(LogLevel.WARN);
      callAll();
      const lines = written();
      expect(lines).toHaveLength(2);
      expect(lines.map((l) => l.level)).toEqual(['WARN', 'ERROR']);
    });

    it('emits only ERROR at ERROR threshold', () => {
      logger.setLogLevel(LogLevel.ERROR);
      callAll();
      const lines = written();
      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe('ERROR');
      expect(lines[0].message).toBe('e-msg');
    });
  });

  describe('JSON line shape', () => {
    it('writes a single newline-terminated JSON line with timestamp, level, message, pid and context', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.info('hello world', { operation: 'read', collection: 'articles', itemId: 7 });

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const raw = String(stderrSpy.mock.calls[0][0]);
      expect(raw.endsWith('\n')).toBe(true);

      const entry = JSON.parse(raw.trim());
      expect(entry.level).toBe('INFO');
      expect(entry.message).toBe('hello world');
      expect(entry.pid).toBe(process.pid);
      expect(entry.operation).toBe('read');
      expect(entry.collection).toBe('articles');
      expect(entry.itemId).toBe(7);
      // ISO-8601 timestamp
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
    });

    it('logs without a context object', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.debug('no context');
      const [entry] = written();
      expect(entry.level).toBe('DEBUG');
      expect(entry.message).toBe('no context');
      expect(entry.timestamp).toBeDefined();
    });
  });

  describe('startTimer / endTimer', () => {
    it('returns a duration >= 0, logs the message and deletes the entry', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.startTimer('op-1');
      const duration = logger.endTimer('op-1', 'operation finished', { collection: 'articles' });

      expect(duration).toBeGreaterThanOrEqual(0);
      const lines = written();
      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe('INFO');
      expect(lines[0].message).toBe('operation finished');
      expect(lines[0].duration).toBe(duration);
      expect(lines[0].operationId).toBe('op-1');
      expect(lines[0].collection).toBe('articles');

      // entry deleted: a second endTimer hits the unknown-id branch
      stderrSpy.mockClear();
      const second = logger.endTimer('op-1', 'should not appear');
      expect(second).toBe(0);
      const warnLines = written();
      expect(warnLines).toHaveLength(1);
      expect(warnLines[0].level).toBe('WARN');
      expect(warnLines[0].message).toBe('Timer not found for operation');
      expect(warnLines[0].operationId).toBe('op-1');
    });

    it('returns duration without logging when no message is given', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.startTimer('quiet-op');
      const duration = logger.endTimer('quiet-op');
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('warns and returns 0 for an unknown operation id', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      const duration = logger.endTimer('never-started');
      expect(duration).toBe(0);
      const [entry] = written();
      expect(entry.level).toBe('WARN');
      expect(entry.message).toBe('Timer not found for operation');
      expect(entry.operationId).toBe('never-started');
    });
  });

  describe('API logging', () => {
    it('apiRequest logs an INFO entry with method, url and type', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.apiRequest('GET', '/items/articles', { requestId: 'r1' });
      const [entry] = written();
      expect(entry.level).toBe('INFO');
      expect(entry.message).toBe('API Request');
      expect(entry.method).toBe('GET');
      expect(entry.url).toBe('/items/articles');
      expect(entry.type).toBe('api_request');
      expect(entry.requestId).toBe('r1');
    });

    it('apiResponse logs INFO for status < 400', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.apiResponse('GET', '/items/articles', 200, 12);
      const [entry] = written();
      expect(entry.level).toBe('INFO');
      expect(entry.message).toBe('API Response');
      expect(entry.status).toBe(200);
      expect(entry.duration).toBe(12);
      expect(entry.type).toBe('api_response');
    });

    it('apiResponse logs ERROR for status >= 400', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.apiResponse('POST', '/items/articles', 404, 5);
      logger.apiResponse('POST', '/items/articles', 500, 9);
      const lines = written();
      expect(lines.map((l) => l.level)).toEqual(['ERROR', 'ERROR']);
      expect(lines[0].status).toBe(404);
      expect(lines[1].status).toBe(500);
    });

    it('apiResponse with status < 400 is filtered at ERROR threshold while >= 400 still emits', () => {
      logger.setLogLevel(LogLevel.ERROR);
      logger.apiResponse('GET', '/x', 200, 1);
      expect(stderrSpy).not.toHaveBeenCalled();
      logger.apiResponse('GET', '/x', 403, 1);
      const [entry] = written();
      expect(entry.level).toBe('ERROR');
      expect(entry.status).toBe(403);
    });

    it('apiError logs ERROR with error message and stack', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      const err = new Error('boom');
      logger.apiError('DELETE', '/items/articles/1', err, { collection: 'articles' });
      const [entry] = written();
      expect(entry.level).toBe('ERROR');
      expect(entry.message).toBe('API Error');
      expect(entry.method).toBe('DELETE');
      expect(entry.url).toBe('/items/articles/1');
      expect(entry.error).toBe('boom');
      expect(entry.stack).toContain('boom');
      expect(entry.type).toBe('api_error');
      expect(entry.collection).toBe('articles');
    });
  });

  describe('WebSocket logging', () => {
    it('websocketEvent logs an INFO entry with event and type', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.websocketEvent('connected', { userId: 'u1' });
      const [entry] = written();
      expect(entry.level).toBe('INFO');
      expect(entry.message).toBe('WebSocket Event');
      expect(entry.event).toBe('connected');
      expect(entry.type).toBe('websocket_event');
      expect(entry.userId).toBe('u1');
    });

    it('websocketError logs an ERROR entry with error message and stack', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.websocketError(new Error('socket closed'));
      const [entry] = written();
      expect(entry.level).toBe('ERROR');
      expect(entry.message).toBe('WebSocket Error');
      expect(entry.error).toBe('socket closed');
      expect(entry.stack).toContain('socket closed');
      expect(entry.type).toBe('websocket_error');
    });
  });

  describe('tool execution logging', () => {
    it('toolStart logs an INFO entry with stringified args', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.toolStart('get_collection_items', { collection: 'articles', limit: 5 });
      const [entry] = written();
      expect(entry.level).toBe('INFO');
      expect(entry.message).toBe('Tool Execution Started');
      expect(entry.toolName).toBe('get_collection_items');
      expect(entry.args).toBe(JSON.stringify({ collection: 'articles', limit: 5 }));
      expect(entry.type).toBe('tool_start');
    });

    it('toolEnd logs INFO on success', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.toolEnd('get_collection_items', 42, true);
      const [entry] = written();
      expect(entry.level).toBe('INFO');
      expect(entry.message).toBe('Tool Execution Completed');
      expect(entry.toolName).toBe('get_collection_items');
      expect(entry.duration).toBe(42);
      expect(entry.success).toBe(true);
      expect(entry.type).toBe('tool_end');
    });

    it('toolEnd logs ERROR on failure', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.toolEnd('delete_items', 7, false);
      const [entry] = written();
      expect(entry.level).toBe('ERROR');
      expect(entry.success).toBe(false);
    });

    it('toolEnd success is filtered at ERROR threshold while failure still emits', () => {
      logger.setLogLevel(LogLevel.ERROR);
      logger.toolEnd('tool-a', 1, true);
      expect(stderrSpy).not.toHaveBeenCalled();
      logger.toolEnd('tool-a', 1, false);
      expect(written()).toHaveLength(1);
    });

    it('toolError logs an ERROR entry with error message and stack', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logger.toolError('create_item', new Error('validation failed'), { collection: 'articles' });
      const [entry] = written();
      expect(entry.level).toBe('ERROR');
      expect(entry.message).toBe('Tool Execution Error');
      expect(entry.toolName).toBe('create_item');
      expect(entry.error).toBe('validation failed');
      expect(entry.stack).toContain('validation failed');
      expect(entry.type).toBe('tool_error');
      expect(entry.collection).toBe('articles');
    });
  });

  describe('convenience functions', () => {
    it('log() delegates to logger.info', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      log('plain message', { operation: 'sync' });
      const [entry] = written();
      expect(entry.level).toBe('INFO');
      expect(entry.message).toBe('plain message');
      expect(entry.operation).toBe('sync');
    });

    it('logError() logs ERROR with error details', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logError('failed badly', new Error('kaput'), { requestId: 'r9' });
      const [entry] = written();
      expect(entry.level).toBe('ERROR');
      expect(entry.message).toBe('failed badly');
      expect(entry.error).toBe('kaput');
      expect(entry.stack).toContain('kaput');
      expect(entry.requestId).toBe('r9');
    });

    it('logError() handles a missing error argument', () => {
      logger.setLogLevel(LogLevel.DEBUG);
      logError('failed without error object');
      const [entry] = written();
      expect(entry.level).toBe('ERROR');
      expect(entry.message).toBe('failed without error object');
      expect(entry.error).toBeUndefined();
      expect(entry.stack).toBeUndefined();
    });
  });
});
