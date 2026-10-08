const app = document.querySelector('#app');
const dialog = document.querySelector('#rules-dialog');
const connection = document.querySelector('#connection');
let state = null;
let token = sessionStorage.getItem('pool-party-session');
let stream = null;
let mode = new URLSearchParams(location.search).has('room') ? 'join' : 'create';
let offset = 0;
let online = false;
let busy = false;
let lastTurn = null;
let toastTimer;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = value => Number(value ?? 0).toLocaleString('en-US');
const player = id => state?.players.find(p => p.id === id);
const me = () => player(state?.you);
const isHost = () => state?.you === state?.hostId;
const icon = '<span aria-hidden="true">↗</span>';

function toast(message, error = false) {
  const element = document.querySelector('#toast');
  element.textContent = message; element.className = `visible ${error ? 'error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.className = '', 5000);
}
async function request(path, data) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (data) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { method: data ? 'POST' : 'GET', headers, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || 'Could not connect. Try again.'); error.status = response.status; throw error; }
  return result;
}
function setConnection(connected) {
  online = connected;
  connection.className = state ? `connection ${connected ? '' : 'offline'}` : 'connection hidden';
  connection.textContent = connected ? 'LIVE' : 'RECONNECTING';
  for (const button of document.querySelectorAll('[data-game-action]')) button.disabled = !connected || button.dataset.locked === 'true';
}
function connect() {
  stream?.close();
  let stopped = false;
  const controller = new AbortController();
  stream = { close() { stopped = true; controller.abort(); } };
  async function poll() {
    if (stopped) return;
    try {
      const next = await request('/api/state');
      if (stopped) return;
      setConnection(true); acceptState(next);
    } catch (error) {
      if (stopped) return;
      setConnection(false);
      if (error.status === 401) {
        stream.close(); token = null; sessionStorage.removeItem('pool-party-session'); state = null; render(); toast('Your room expired. Create or join a new one.', true); return;
      }
    }
    if (!stopped) setTimeout(poll, online ? 500 : 1500);
  }
  poll();
}
function acceptState(next) {
  offset = next.serverTime - Date.now();
  if (state && next.revision < state.revision) return;
  const changedTurn = next.turn !== lastTurn;
  state = next; lastTurn = next.turn;
  if (changedTurn) sessionStorage.removeItem('pool-party-choice');
  render();
}

function landing() {
  const invite = new URLSearchParams(location.search).get('room') ?? '';
  return `<section class="landing">
    <div class="hero"><div class="pill"><span class="live-dot"></span> THE TRIVIA GAME WITH SKIN IN IT</div>
      <h1>Bet on what<br>you <span class="underlined">know.</span></h1>
      <p class="hero-copy">A little trivia. A little nerve. Bid for your shot at the answer—and steal the pool when your friends miss.</p>
      <div class="hero-facts"><span><b>2–8</b> friends</span><span><b>8</b> rounds</span><span><b>~15 min</b> to glory</span></div>
      <div class="illustration" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="chip chip-blue">70<span>POINTS</span></div><div class="chip chip-coral">300<span>POINTS</span></div><div class="pool-coin"><span>THE POOL</span><b>₊</b><small>WIN IT ALL</small></div><span class="spark spark-one">✦</span><span class="spark spark-two">✦</span><div class="note">Confidence<br>looks good on you.<span>↗</span></div></div>
    </div>
    <div class="entry-column"><div class="entry-card"><div class="tabs" role="tablist" aria-label="Room options"><button role="tab" aria-selected="${mode === 'create'}" class="${mode === 'create' ? 'selected' : ''}" data-action="create-tab">Host a party</button><button role="tab" aria-selected="${mode === 'join'}" class="${mode === 'join' ? 'selected' : ''}" data-action="join-tab">Join a party</button></div>
      <span class="eyebrow">${mode === 'create' ? 'YOUR TABLE. YOUR FRIENDS.' : 'YOU’RE INVITED.'}</span><h2>${mode === 'create' ? 'Make some<br>friendly rivals.' : 'Pull up<br>a seat.'}</h2><p class="muted">${mode === 'create' ? 'Create a room, share the code, and let the bidding begin.' : 'Grab the room code from your host. No account needed.'}</p>
      <form id="entry-form"><label for="name">Your nickname</label><input id="name" name="name" maxlength="20" autocomplete="nickname" placeholder="e.g. Quiz Khalifa" required value="${esc(sessionStorage.getItem('pool-party-name') ?? '')}">
      ${mode === 'join' ? `<label for="code">Room code</label><input id="code" name="code" class="code-input" maxlength="6" minlength="6" autocapitalize="characters" autocomplete="off" placeholder="ABC123" required value="${esc(invite)}">` : ''}
      <button class="button primary full" type="submit">${mode === 'create' ? 'Create my room' : 'Join the party'} ${icon}</button><p class="small muted entry-note">Free to play. No downloads. Just bragging rights.</p></form></div>
      <div class="mini-guide"><span class="mini-number">01</span><div><b>Bid. Answer. Cash in.</b><p>We’ll teach you as you play.</p></div><button class="round-button" data-action="rules" aria-label="Read the rules">↗</button></div>
    </div>
  </section>`;
}
function timerMarkup(label = 'TIME LEFT') { return `<div class="timer"><span class="eyebrow">${label}</span><b class="time" aria-label="Seconds remaining">—</b><div class="timer-bar"><i></i></div></div>`; }
function gameButton(action, label, locked = false, extra = '') { return `<button class="button primary ${extra}" data-game-action="${action}" data-locked="${locked}" ${locked || !online ? 'disabled' : ''}>${label}</button>`; }
function playerList() {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  return `<aside class="scoreboard"><div class="board-heading"><span class="eyebrow">THE PLAYERS</span><span>${state.players.length}/8</span></div><div class="player-list">${ranked.map((p, i) => `<div class="player-row ${p.id === state.you ? 'you' : ''} ${p.id === state.activeId ? 'active-player' : ''}"><div class="avatar ${p.color}">${esc(p.name[0].toUpperCase())}</div><div class="player-info"><b>${esc(p.name)} ${p.id === state.you ? '<small>YOU</small>' : ''}</b><span>${!p.connected ? 'Reconnecting…' : state.phase === 'lobby' ? (p.ready ? 'Ready to play ✓' : 'Reading the rules') : state.eliminated.includes(p.id) ? 'Back next round' : p.id === state.activeId ? 'Answering now' : state.phase === 'bidding' ? p.bid ? `Bid: ${number(p.bid)}` : 'No bid yet' : p.id === state.hostId ? 'Room host' : `Rank #${i + 1}`}</span></div><strong>${number(p.score)}</strong></div>`).join('')}</div><div class="pool-total"><span>POINTS IN THE POOL</span><b>${number(state.pool)}<small> PTS</small></b><p>${state.pool ? 'A correct answer takes it all.' : 'Wrong answers grow the pool.'}</p></div></aside>`;
}
function categoryPicker() {
  return `<fieldset class="category-picker"><legend>Choose your trivia categories</legend><p class="small muted">${isHost() ? 'Choose at least four categories for the whole game. Changes reset player readiness.' : 'Your host picks the topics for the whole game.'}</p><div class="category-grid">${state.availableCategories.map(category => `<label><input type="checkbox" name="category" value="${esc(category)}" ${state.categories.includes(category) ? 'checked' : ''} ${!isHost() || !online || busy ? 'disabled' : ''}><span>${esc(category)}</span></label>`).join('')}</div><p class="small muted">The same selection applies to every question.</p></fieldset>`;
}
function lobby() {
  const allReady = state.questionSource?.status !== 'loading' && state.players.length >= 2 && state.players.every(p => p.ready && p.connected);
  return `<div class="stage-head"><span class="eyebrow">WELCOME TO THE TABLE</span><span class="phase-pill">LOBBY</span></div><h2>Good company.<br>Questionable confidence.</h2><p class="stage-copy">Share the code above. Everyone plays on their own device.</p><div class="steps"><div><span>1</span><b>See a category</b><p>The question is still a mystery.</p></div><div><span>2</span><b>Bid for your turn</b><p>50–300 points. Highest goes first.</p></div><div><span>3</span><b>Answer & win</b><p>Earn your bid + the pool. Miss and lose your bid.</p></div></div><div class="start-score"><span class="coin-small">₊</span><p>You start with <strong>1,000 points.</strong><br>Eight rounds. Highest total wins.</p></div>${categoryPicker()}<p class="question-status" role="status">${state.questionSource?.status === 'loading' ? 'Loading fresh questions… You can get ready while we prepare.' : state.questionSource?.mode === 'mixed' ? 'Fresh questions ready. Let’s play.' : 'Curated questions ready. Let’s play.'}</p>${state.questionSource?.mayRepeat ? '<p class="small muted">Small question pool: questions may repeat if your selected categories run out.</p>' : ''}${gameButton('ready', me().ready ? 'Ready ✓ — tap to unready' : 'I understand. I’m ready.', false, 'full')}<div class="host-controls">${isHost() ? gameButton('start', 'Start the party ↗', !allReady, 'full') : `<p class="muted">${me().ready ? 'Waiting for your host to start…' : 'Tap ready when you’ve read the basics.'}</p>`}<p class="small muted">${state.players.length < 2 ? 'You need at least one friend to start.' : 'The host can start once everyone is ready.'}</p></div>`;
}
function bidding() {
  const highest = Math.max(0, ...state.players.map(p => p.bid));
  const max = Math.min(300, Math.floor(me().score / 10) * 10);
  const next = Math.min(max, Math.max(50, me().bid + 10, highest + 10));
  const locked = max < 50 || me().bid >= max;
  return `<div class="stage-head"><span class="eyebrow">BACK YOURSELF</span><span class="phase-pill">OPEN BIDDING</span></div>${timerMarkup('BIDDING CLOSES IN')}<h2 class="category-title">${esc(state.category)}<span class="category-spark">✦</span></h2><p class="stage-copy">Know your stuff? Raise your bid.<br>The question is revealed when bidding closes.</p><div class="bid-summary"><div><span>YOUR BID</span><b>${number(me().bid)}<small> PTS</small></b></div><div><span>TABLE’S HIGHEST</span><b>${number(highest)}<small> PTS</small></b></div></div>${locked ? `<div class="notice">${max < 50 ? 'You have fewer than 50 points. Sit out bidding—you can still win a bonus pool.' : 'You’ve reached your bidding limit. Your bid is locked in.'}</div>` : `<form id="bid-form"><label for="bid">Your next bid</label><div class="bid-controls"><button type="button" class="step-button" data-action="bid-minus" aria-label="Decrease bid by 10">−</button><input id="bid" name="amount" type="number" min="${Math.max(50, me().bid + 10)}" max="${max}" step="10" value="${next}" required><button type="button" class="step-button" data-action="bid-plus" aria-label="Increase bid by 10">+</button><button class="button primary" type="submit" data-game-action="bid-submit" data-locked="false" ${!online ? 'disabled' : ''}>Place bid ↗</button></div></form>`}<p class="small muted">No bid means you pass. Ties go to the earlier bid. You only lose points if you get an answer attempt.</p>`;
}
function questionStage() {
  const yours = state.activeId === state.you;
  const bonus = state.phase.startsWith('bonus');
  const buzzing = state.phase === 'bonus-buzz';
  const out = state.eliminated.includes(state.you);
  return `<div class="stage-head"><span class="eyebrow">${bonus ? 'A SHOT AT THE POOL' : 'TIME TO PROVE IT'}</span><span class="phase-pill">${buzzing ? 'BUZZER OPEN' : bonus ? 'BONUS ANSWER' : 'ANSWER TIME'}</span></div>${timerMarkup(buzzing ? 'BUZZ BEFORE' : 'ANSWER BEFORE')}<div class="question-category">${esc(state.question.category)}</div><h2 class="question-text">${esc(state.question.text)}</h2>${buzzing ? out ? '<div class="notice">You’re out of this bonus sequence. Cheer on the others—you’re back next round.</div>' : gameButton('buzz', 'BUZZ IN', false, 'buzzer full') : yours ? `<div class="your-turn">YOUR MOMENT ${bonus ? `· WIN ${number(state.pool)} POINTS` : `· CORRECT WINS ${number(me().bid + state.pool)} POINTS`}</div><form id="answer-form"><fieldset class="answer-choices"><legend>Choose one answer</legend>${state.question.choices.map((choice, index) => `<label class="answer-option"><input type="radio" name="choiceId" value="${esc(choice.id)}" required ${sessionStorage.getItem('pool-party-choice') === choice.id ? 'checked' : ''}><span class="option-letter">${String.fromCharCode(65 + index)}</span><span>${esc(choice.text)}</span></label>`).join('')}</fieldset><button type="submit" class="button primary full" data-game-action="answer-submit" data-locked="false" ${!online ? 'disabled' : ''}>Lock it in ↗</button></form><p class="small muted">${bonus ? 'No extra points lost if you miss. You’ll be out of this bonus sequence.' : `Wrong or out of time? ${number(me().bid)} points go into the pool.`}</p>` : `<div class="waiting-turn"><span class="avatar ${player(state.activeId)?.color}">${esc(player(state.activeId)?.name[0] ?? '?')}</span><p><strong>${esc(player(state.activeId)?.name)}</strong> is answering.<br><span class="muted">${out ? 'You return next round.' : 'Your moment could be next.'}</span></p></div>`}`;
}
function bonusIntro() {
  return `<div class="stage-head"><span class="eyebrow">PLOT TWIST</span><span class="phase-pill coral-pill">BONUS TIME</span></div><h2>Nobody nailed it.<br>Who’s quickest?</h2><p class="stage-copy">There are <strong>${number(state.pool)} points</strong> up for grabs. A fresh question. A fresh chance.</p><ol class="rule-list bonus-rules"><li><strong>Buzz first to answer.</strong> No new bids. Everyone can play—even if you passed.</li><li><strong>Get it right, take the pool.</strong> No extra points lost if you miss.</li><li><strong>Miss and sit this bonus out.</strong> The remaining players get a different question.</li></ol><p class="small muted">If everyone misses, or nobody buzzes in 20 seconds, the pool clears. You all return next round. The first accepted buzz wins the buzzer.</p>${gameButton('ready', me().ready ? 'Got it ✓ — waiting for everyone' : 'Got it. Let’s buzz.', me().ready, 'full')}<p class="small muted">${state.players.filter(p => p.ready).length}/${state.players.length} ready · starts automatically in <span class="time">—</span> seconds.</p>`;
}
function countdown() {
  const out = state.eliminated.includes(state.you);
  return `<div class="stage-head"><span class="eyebrow">${state.eliminated.length ? 'A FRESH QUESTION' : 'GET YOUR BUZZER READY'}</span><span class="phase-pill">BONUS</span></div><div class="countdown"><span class="time">3</span><h2>${out ? 'Watch the action.' : 'Fingers at the ready.'}</h2><p>${out ? 'You’re back in the next regular round.' : 'The question and buzzer appear together.'}</p><div class="pill">${state.players.length - state.eliminated.length} PLAYERS · ${number(state.pool)} POINTS</div></div>`;
}
function resultStage() {
  return `<div class="stage-head"><span class="eyebrow">ROUND ${state.round} WRAPPED</span><span class="phase-pill">THE REVEAL</span></div><div class="result-symbol">${state.result.winnerId ? '✦' : '↻'}</div><h2>${esc(state.result.title)}</h2><p class="stage-copy">${esc(state.result.detail)}</p>${state.result.answer ? `<div class="answer-reveal"><span class="eyebrow">THE ANSWER</span><b>${esc(state.result.answer)}</b></div>` : ''}${isHost() ? gameButton('next', state.round === 8 ? 'See the final scores ↗' : 'Next category ↗', false, 'full') : '<p class="muted">Your host can continue, or we’ll move on automatically.</p>'}<p class="small muted">${state.round === 8 ? 'Final scores' : 'Next round'} in <span class="time">—</span> seconds.</p>`;
}
function finished() {
  const best = Math.max(...state.players.map(p => p.score));
  const winners = state.players.filter(p => p.score === best);
  return `<div class="stage-head"><span class="eyebrow">THAT’S A WRAP</span><span class="phase-pill">FINAL SCORES</span></div><div class="result-symbol">♛</div><h2>${winners.length === 1 ? `${esc(winners[0].name)}<br>takes the crown.` : 'A shared crown.'}</h2><p class="stage-copy">${winners.length > 1 ? `${winners.map(p => esc(p.name)).join(' & ')} tie with ` : 'Eight rounds. Plenty of nerve. ' }<strong>${number(best)} points.</strong></p><div class="final-ranks">${[...state.players].sort((a, b) => b.score - a.score).map(p => `<div><span>${p.score === best ? '♛' : '·'}</span><b>${esc(p.name)}</b><strong>${number(p.score)}</strong></div>`).join('')}</div>${isHost() ? gameButton('rematch', 'Run it back ↗', false, 'full') : '<p class="muted">Your host can start a rematch with the same room code.</p>'}<button class="text-button new-room-button" data-action="new-room">Create a new party</button>`;
}
function disconnectedControls() {
  if (state.phase !== 'lobby' || !isHost()) return '';
  const absent = state.players.filter(p => !p.connected && p.id !== state.you);
  if (!absent.length) return '';
  return `<div class="notice"><p>A friend disconnected. You can remove them so everyone can get ready.</p>${absent.map(p => `<button class="text-button" data-game-action="remove" data-player-id="${esc(p.id)}" data-locked="false" ${!online ? 'disabled' : ''}>Remove ${esc(p.name)} ↗</button>`).join('')}</div>`;
}
function room() {
  const stages = { lobby, bidding, answer: questionStage, 'bonus-intro': bonusIntro, 'bonus-countdown': countdown, 'bonus-buzz': questionStage, 'bonus-answer': questionStage, result: resultStage, finished };
  return `<section class="room"><div class="room-heading"><div><span class="eyebrow">YOUR PARTY</span><div class="room-code">${esc(state.code)}<button class="icon-button" data-action="copy-code" aria-label="Copy room code">⧉</button></div></div><div class="room-meta"><span>${state.phase === 'lobby' ? 'WAITING FOR FRIENDS' : `ROUND ${state.round} OF 8`}</span><button class="text-button" data-action="share">Copy invite link ↗</button></div></div><div class="game-layout">${playerList()}<section class="stage">${stages[state.phase]()}${disconnectedControls()}</section></div>${state.questionSource?.attribution ? '<p class="trivia-credit">Includes questions from <a href="https://opentdb.com" target="_blank" rel="noopener noreferrer">Open Trivia Database</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a> · category labels and option order adapted.</p>' : ''}${state.events.length ? `<div class="activity"><span class="eyebrow">AT THE TABLE</span><div aria-live="polite">${state.events.slice(-3).map(event => `<p>${esc(event)}</p>`).join('')}</div></div>` : ''}</section>`;
}
function render() {
  const focused = document.activeElement;
  const saved = focused?.tagName === 'INPUT' && focused.id ? { id: focused.id, value: focused.value, start: focused.selectionStart, end: focused.selectionEnd } : null;
  app.innerHTML = state ? room() : landing();
  setConnection(online);
  if (saved && document.getElementById(saved.id)) {
    const element = document.getElementById(saved.id);
    const max = Number(element.max || Infinity), min = Number(element.min || -Infinity);
    element.value = saved.id === 'bid' ? Math.max(min, Math.min(max, Number(saved.value))) : saved.value;
    element.focus({ preventScroll: true });
    if (saved.start !== null) element.setSelectionRange(saved.start, saved.end);
  }
  updateTimers();
}
function updateTimers() {
  if (!state?.deadline) return;
  const seconds = Math.max(0, Math.ceil((state.deadline - Date.now() - offset) / 1000));
  for (const element of document.querySelectorAll('.time')) { element.textContent = seconds; element.classList.toggle('urgent', seconds <= 5); }
  const duration = state.phase === 'bidding' ? 25 : 15;
  for (const bar of document.querySelectorAll('.timer-bar i')) bar.style.width = `${Math.min(100, seconds / duration * 100)}%`;
}
async function action(name, extra = {}) {
  if (!online) { toast('Reconnecting—wait for the LIVE indicator.', true); return; }
  if (busy) return;
  busy = true;
  try { acceptState(await request('/api/action', { action: name, turn: state.turn, ...extra })); }
  catch (error) { toast(error.message, true); }
  finally { busy = false; }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const name = button.dataset.action;
  if (name === 'rules') dialog.showModal();
  else if (name === 'close-rules') dialog.close();
  else if (name === 'create-tab' || name === 'join-tab') {
    const input = document.getElementById('name'); if (input) sessionStorage.setItem('pool-party-name', input.value);
    mode = name === 'join-tab' ? 'join' : 'create'; render();
  } else if (name === 'bid-minus' || name === 'bid-plus') {
    const input = document.getElementById('bid'); const value = Number(input.value) + (name === 'bid-plus' ? 10 : -10);
    input.value = Math.max(Number(input.min), Math.min(Number(input.max), value));
  } else if (name === 'copy-code' || name === 'share') {
    const value = name === 'copy-code' ? state.code : `${location.origin}/?room=${state.code}`;
    try { await navigator.clipboard.writeText(value); toast(name === 'copy-code' ? 'Room code copied!' : 'Invite link copied!'); }
    catch { window.prompt('Copy this invitation:', value); }
  } else if (name === 'new-room') {
    stream?.close(); stream = null; token = null; state = null; sessionStorage.removeItem('pool-party-session'); history.replaceState({}, '', '/'); mode = 'create'; render();
  } else if (button.dataset.gameAction && !button.dataset.gameAction.endsWith('-submit')) {
    await action(button.dataset.gameAction, button.dataset.gameAction === 'ready' ? { ready: !me().ready } : button.dataset.gameAction === 'remove' ? { playerId: button.dataset.playerId } : {});
  }
});
document.addEventListener('change', async event => {
  if (event.target.name !== 'category') return;
  const categories = [...document.querySelectorAll('input[name="category"]:checked')].map(input => input.value);
  if (categories.length < 4) { event.target.checked = true; toast('Choose at least four categories.', true); return; }
  await action('categories', { categories });
  render();
});
document.addEventListener('input', event => {
  if (event.target.name === 'choiceId') sessionStorage.setItem('pool-party-choice', event.target.value);
  if (event.target.id === 'code') event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  if (form.id === 'entry-form') {
    if (busy) return; busy = true;
    const submit = form.querySelector('button[type=submit]'); submit.disabled = true; submit.textContent = 'Finding your table…';
    try {
      const result = await request(mode === 'create' ? '/api/rooms' : '/api/join', values);
      token = result.session; sessionStorage.setItem('pool-party-session', token); sessionStorage.setItem('pool-party-name', values.name.trim());
      acceptState(result.state); connect();
    } catch (error) { toast(error.message, true); render(); }
    finally { busy = false; }
  } else if (form.id === 'bid-form') await action('bid', { amount: Number(values.amount) });
  else if (form.id === 'answer-form') await action('answer', { choiceId: values.choiceId });
});
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
setInterval(updateTimers, 200);
render();
if (token) {
  request('/api/state').then(next => { acceptState(next); connect(); }).catch(error => {
    if (error.status === 401) { token = null; sessionStorage.removeItem('pool-party-session'); }
    toast(error.status === 401 ? 'Your previous room expired. Start a fresh party.' : 'Could not restore your room. Refresh to retry.', true);
  });
}
