/**
 * 服务端口与 WRITER_API_URL 解析单测
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveServicePort, resolveWriterApiUrl } from '../../src/config/service-endpoints.ts';

describe('service-endpoints', () => {
  it('defaults API URL and server port to the same value', () => {
    assert.equal(resolveServicePort({}), 4000);
    assert.equal(resolveWriterApiUrl({}), 'http://127.0.0.1:4000');
  });

  it('honors WRITER_API_URL over PORT for clients', () => {
    assert.equal(
      resolveWriterApiUrl({ PORT: '5000', WRITER_API_URL: 'http://127.0.0.1:5001' }),
      'http://127.0.0.1:5001',
    );
  });
});
