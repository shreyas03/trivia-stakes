import { CATEGORIES } from '../shared/categories.js';
import { QUESTIONS, normalizeAnswer } from '../shared/questions.js';

const API_ORIGIN = 'https://opentdb.com';
const GAP_MS = 5100;
const DECK_SIZE = 80;
const CATEGORY_NAMES = {
  'Entertainment: Film': 'Movies', 'Entertainment: Music': 'Music',
  'Entertainment: Books': 'Books', 'Entertainment: Video Games': 'Gaming',
  'Science: Computers': 'Technology', 'Science & Nature': 'Science',
  'Science: Mathematics': 'Mathematics', 'General Knowledge': 'General Knowledge',
};
const CREDIT = Object.freeze({ name: 'Open Trivia Database', url: 'https://opentdb.com', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const value = new Uint32Array(1); crypto.getRandomValues(value);
    const j = Math.floor(value[0] / 4294967296 * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
export function questionKey(question) { return normalizeAnswer(question.text); }

/** URL3986 encoding returns plain text after decoding, not HTML markup. */
export function parseLiveQuestion(row) {
  try {
    if (row?.type !== 'multiple' || row.difficulty !== 'medium' || !Array.isArray(row.incorrect_answers) || row.incorrect_answers.length !== 3) return null;
    const decode = value => { if (typeof value !== 'string') throw new Error('Invalid field'); return decodeURIComponent(value).trim(); };
    const text = decode(row.question), category = decode(row.category), correct = decode(row.correct_answer);
    const options = [correct, ...row.incorrect_answers.map(decode)];
    if (!text || text.length > 600 || !category || category.length > 100 || options.some(s => !s || s.length > 160)) return null;
    if (new Set(options.map(normalizeAnswer)).size !== 4) return null;
    return { id: `live:${normalizeAnswer(text)}`, text, category: CATEGORY_NAMES[category] ?? category.replace(/^Entertainment: /, ''), answers: [correct], options, difficulty: 'medium', source: { ...CREDIT } };
  } catch { return null; }
}

/** One server-wide queue respects the API's per-IP limit, even across concurrent rooms. */
export class TriviaProvider {
  constructor({ fetchFn = fetch, now = Date.now, wait = sleep, enabled = true } = {}) {
    this.fetchFn = fetchFn; this.now = now; this.wait = wait; this.enabled = enabled;
    this.token = null; this.queue = Promise.resolve(); this.nextRequestAt = 0;
    this.refreshing = null; this.retryAt = 0; this.pool = []; this.recent = new Map(); this.sequence = 0;
  }
  recordUsed(question) {
    const key = questionKey(question);
    this.recent.delete(key); this.recent.set(key, ++this.sequence);
    while (this.recent.size > 500) this.recent.delete(this.recent.keys().next().value);
  }
  request(path) {
    const run = this.queue.then(async () => {
      const delay = Math.max(0, this.nextRequestAt - this.now());
      if (delay) await this.wait(delay);
      this.nextRequestAt = this.now() + GAP_MS;
      const response = await this.fetchFn(`${API_ORIGIN}${path}`, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Trivia service unavailable');
      return response.json();
    });
    this.queue = run.catch(() => {});
    return run;
  }
  async refresh() {
    if (!this.enabled || this.now() < this.retryAt) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        if (!this.token) {
          const token = await this.request('/api_token.php?command=request');
          if (token.response_code !== 0 || typeof token.token !== 'string' || !/^[a-zA-Z0-9]{10,128}$/.test(token.token)) throw new Error('Invalid trivia token');
          this.token = token.token;
        }
        const data = await this.request(`/api.php?amount=50&difficulty=medium&type=multiple&encode=url3986&token=${encodeURIComponent(this.token)}`);
        if (data.response_code !== 0 || !Array.isArray(data.results)) {
          if ([3, 4].includes(data.response_code)) this.token = null;
          throw new Error('Trivia batch unavailable');
        }
        const keys = new Set(this.pool.map(questionKey));
        for (const row of data.results.slice(0, 50)) {
          const question = parseLiveQuestion(row);
          if (!question || keys.has(questionKey(question)) || this.recent.has(questionKey(question))) continue;
          keys.add(questionKey(question)); this.pool.push(question);
        }
        if (!this.pool.length) throw new Error('No usable fresh trivia');
      } catch {
        // A failing service must never prevent a complete eight-round game.
        this.retryAt = this.now() + 60000;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }
  async loadDeck(categories = CATEGORIES) {
    const selected = new Set(categories);
    this.pool = this.pool.filter(q => !this.recent.has(questionKey(q)));
    if (this.pool.length < 30) await this.refresh();
    const live = this.pool.filter(q => selected.has(q.category)).slice(0, 50);
    const taken = new Set(live); this.pool = this.pool.filter(q => !taken.has(q));
    const keys = new Set(live.map(questionKey));
    // Least recently PLAYED local prompts come first; unused deck entries don't count.
    const local = shuffle(QUESTIONS)
      .filter(q => selected.has(q.category) && !keys.has(questionKey(q)))
      .sort((a, b) => (this.recent.get(questionKey(a)) ?? 0) - (this.recent.get(questionKey(b)) ?? 0))
      .slice(0, DECK_SIZE - live.length);
    const combined = [...live, ...local];
    const fresh = shuffle(combined.filter(q => !this.recent.has(questionKey(q))));
    const repeats = combined.filter(q => this.recent.has(questionKey(q)))
      .sort((a, b) => this.recent.get(questionKey(a)) - this.recent.get(questionKey(b)));
    const unique = [...fresh, ...repeats];
    if (!unique.length) throw new Error('No questions in these categories');
    const deck = [...unique];
    while (deck.length < DECK_SIZE) deck.push(...shuffle(unique).slice(0, DECK_SIZE - deck.length));
    return {
      deck,
      info: { status: 'ready', mode: live.length ? 'mixed' : 'local', liveCount: live.length, curatedCount: local.length, uniqueCount: unique.length, mayRepeat: unique.length < 72, ...(live.length ? { attribution: { ...CREDIT } } : {}) },
    };
  }
}
