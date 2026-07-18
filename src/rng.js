// rng.js
// WHAT: seedable PRNG (mulberry32) and helpers built on it.
// WHY: a fixed seed must reproduce identical overworld/town/dungeon layouts,
// which Math.random() can never guarantee.

// mulberry32: tiny, fast, decent-quality 32-bit PRNG.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
  }
  // WHAT: float in [0,1).
  next() { return this._next(); }
  // WHAT: integer in [min,max] inclusive.
  int(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; }
  // WHAT: true with probability p.
  chance(p) { return this.next() < p; }
  // WHAT: random element of array.
  choice(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  // WHAT: Fisher-Yates shuffle, returns a new array.
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // WHAT: derive an independent child RNG deterministically from this one.
  // WHY: dungeon levels/towns need their own reproducible stream keyed off a
  // sub-seed without disturbing the parent stream's position.
  fork(salt) {
    const mixed = (this.seed ^ (salt * 0x9e3779b1)) >>> 0;
    return new RNG(mixed);
  }
}
