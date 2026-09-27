export class PagClient {
  constructor({ baseUrl = 'http://127.0.0.1:8787', token, fetchImpl = globalThis.fetch } = {}) {
    if (!token) throw new Error('PAG actor token is required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.fetch = fetchImpl;
  }

  async request(path, options = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `PAG HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  createIntent(capability, args = {}, { idempotencyKey } = {}) {
    return this.request('/v1/intents', {
      method: 'POST',
      headers: idempotencyKey ? { 'x-pag-idempotency-key': idempotencyKey } : {},
      body: JSON.stringify({ capability, args })
    });
  }

  getIntent(id) {
    if (!id) throw new TypeError('intent id is required');
    return this.request(`/v1/intents/${encodeURIComponent(id)}`);
  }
}
