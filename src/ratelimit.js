/**
 * Backpressure primitives for the service. A classification layer sits on the
 * hot path of every agent action, so it must protect itself and its upstream
 * (Jev) from overload rather than collapse under it.
 *
 *   TokenBucket   - smooths burst request rate
 *   Semaphore     - caps concurrent in-flight Jev calls (upstream protection)
 */

export class TokenBucket {
  /** @param {{ratePerSec: number, burst: number}} opts */
  constructor({ ratePerSec, burst }) {
    this.rate = ratePerSec;
    this.capacity = burst;
    this.tokens = burst;
    this.last = Date.now();
  }

  /** @returns {boolean} true if a token was available and consumed */
  take() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

export class Semaphore {
  /** @param {number} max */
  constructor(max) {
    this.max = max;
    this.inFlight = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.inFlight < this.max) {
      this.inFlight++;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.inFlight++;
  }

  release() {
    this.inFlight--;
    const next = this.queue.shift();
    if (next) next();
  }

  get depth() {
    return this.queue.length;
  }
}
