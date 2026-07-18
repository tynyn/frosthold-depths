// log.js
// WHAT: scrolling message log shared by every system (movement, combat,
// shops, specials). WHY: one place to push/render text feedback.

const MAX_LINES = 200;

export class MessageLog {
  constructor() { this.lines = []; }
  push(text) {
    this.lines.push(text);
    if (this.lines.length > MAX_LINES) this.lines.shift();
  }
  recent(n) { return this.lines.slice(-n); }
  render(el, n = 8) {
    el.textContent = this.recent(n).join('\n');
    el.scrollTop = el.scrollHeight;
  }
}
