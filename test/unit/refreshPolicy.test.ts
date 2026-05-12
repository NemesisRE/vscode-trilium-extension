import { strict as assert } from 'assert';
import { EtapiError } from '../../src/etapiClient';
import {
  buildRefreshFailureMessage,
  classifyRefreshFailure,
  shouldUntrackAfterFailure,
  shouldWarnAfterFailure,
} from '../../src/refreshPolicy';

describe('refreshPolicy', () => {
  describe('classifyRefreshFailure', () => {
    it('classifies 404 as notFound', () => {
      assert.strictEqual(
        classifyRefreshFailure(new EtapiError('missing', 404)),
        'notFound',
      );
    });

    it('classifies 401/403 as auth', () => {
      assert.strictEqual(classifyRefreshFailure(new EtapiError('unauthorized', 401)), 'auth');
      assert.strictEqual(classifyRefreshFailure(new EtapiError('forbidden', 403)), 'auth');
    });

    it('classifies 5xx and timeout-like errors as transient', () => {
      assert.strictEqual(classifyRefreshFailure(new EtapiError('server down', 503)), 'transient');
      assert.strictEqual(classifyRefreshFailure(new Error('network timeout while fetching')), 'transient');
    });

    it('classifies unknown errors as unknown', () => {
      assert.strictEqual(classifyRefreshFailure(new Error('unexpected parse issue')), 'unknown');
    });
  });

  describe('shouldUntrackAfterFailure', () => {
    it('always untracks on notFound', () => {
      assert.strictEqual(shouldUntrackAfterFailure('notFound', 1, 8), true);
      assert.strictEqual(shouldUntrackAfterFailure('notFound', 10, 8), true);
    });

    it('untracks at configured threshold for other errors', () => {
      assert.strictEqual(shouldUntrackAfterFailure('transient', 7, 8), false);
      assert.strictEqual(shouldUntrackAfterFailure('transient', 8, 8), true);
    });
  });

  describe('shouldWarnAfterFailure', () => {
    it('warns at threshold and subsequent multiples', () => {
      assert.strictEqual(shouldWarnAfterFailure(1, 3), false);
      assert.strictEqual(shouldWarnAfterFailure(2, 3), false);
      assert.strictEqual(shouldWarnAfterFailure(3, 3), true);
      assert.strictEqual(shouldWarnAfterFailure(4, 3), false);
      assert.strictEqual(shouldWarnAfterFailure(6, 3), true);
    });
  });

  describe('buildRefreshFailureMessage', () => {
    it('builds auth guidance with reconnect language', () => {
      const msg = buildRefreshFailureMessage('Daily Journal', 'auth', 3, 8);
      assert.ok(msg.includes('Daily Journal'));
      assert.ok(msg.includes('Authentication failed'));
      assert.ok(msg.includes('Reconnect'));
    });

    it('builds transient guidance with retry language', () => {
      const msg = buildRefreshFailureMessage('Daily Journal', 'transient', 3, 8);
      assert.ok(msg.includes('Network/server issue'));
      assert.ok(msg.includes('Retry now'));
    });
  });
});
