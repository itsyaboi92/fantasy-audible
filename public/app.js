
let state = null;
let manager = null;
let tab = 'Home';
let token = localStorage.getItem('audibleToken');

let espn = null;
let espnError = '';
let draftSearch = '';
let draftPosition = 'ALL';
let loadingESPN = false;

const $ = id => document.getElementById(id);

const tabs = [
  'Home',
  'My Team',
  'Matchup',
  'League',
  'Players',
  'Draft',
  'Notifications',
  'Commissioner'
];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

function fmt(value) {
  return Number(value || 0).toFixed(1);
}

function m(id) {
  return state?.managers.find(x => x.id === id);
}

function p(id) {
  return state?.players.find(x => x.id === id);
}

function score(player) {
  return player.scoringMode === 'handcuff'
    ? player.credited ?? 0
    : player.points;
}

function total(id) {
  return state.players
    .filter(x => x.owner === id && x.slot !== 'BENCH')
    .reduce((sum, x) => sum + score(x), 0);
}

function card(title, body) {
  return `<section class="card">
    <h2>${title}</h2>
    ${body}
  </section>`;
}

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
  }, 3500);
}

function playerRow(player) {
  return `<div class="row">
    <div>
      <b>${esc(player.name)}</b>
      <div class="muted small">
        ${esc(player.team)} · ${esc(player.pos)} ·
        ${esc(player.slot)} · ${esc(player.status)}
      </div>
    </div>
    <b>${fmt(score(player))}</b>
  </div>`;
}

async function apiPost(route, body) {
  const response = await fetch(route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    },
    body: JSON.stringify(body)
  });

  const result = await response.json();

  if (!response.ok) {
    throw Error(result.error || 'Request failed');
  }

  return result;
}

async function act(route, body) {
  if (
    route === '/api/substitute' &&
    !confirm(
      'This substitution is permanent. Your starter points will be forfeited. Continue?'
    )
  ) return;

  try {
    await apiPost(route, body);
    toast('League updated');
  } catch (error) {
    toast(error.message);
  }
}

async function renameTeam() {
  const current = m(manager)?.team || '';
  const proposed = prompt('Enter your fantasy team name:', current);

  if (proposed === null) return;

  const name = proposed.trim().replace(/\s+/g, ' ');

  if (name === current) return;

  try {
    const result = await apiPost('/api/team-name', { name });
    m(manager).team = result.team;
    render();
    toast('Team name updated');
  } catch (error) {
    toast(error.message);
  }
}

function injuryCard(injury) {
  const starter = p(injury.player);

  if (!starter || starter.owner !== manager) return '';

  const choices = state.players
    .filter(x =>
      x.owner === manager &&
      x.slot === 'BENCH' &&
      x.pos === starter.pos
    )
    .map(x => {
      const sameTeam =
        x.team === starter.team &&
        x.kickoff <= state.phase;

      const later = x.kickoff > state.phase;

      const eligible = sameTeam || later;

      const explanation = sameTeam
        ? 'Same-team handcuff: future points only'
        : later
        ? 'Later kickoff: full-game points'
        : 'Not eligible';

      return `<div class="row">
        <div>
          <b>${esc(x.name)}</b>
          <div class="muted small">${explanation}</div>
        </div>
        <button ${eligible ? '' : 'disabled'}
          onclick="act('/api/substitute',{
            injury:${JSON.stringify(injury.id)},
            bench:${JSON.stringify(x.id)}
          })">
          Substitute
        </button>
      </div>`;
    })
    .join('');

  return card('Injury substitution available', `
    <p>
      <b>${esc(starter.name)}</b> —
      ${fmt(starter.points)} points
    </p>
    <p>Keep your starter or permanently substitute.</p>
    ${choices || '<p>No eligible bench players.</p>'}
    <button onclick="act('/api/keep',{
      injury:${JSON.stringify(injury.id)}
    })">
      Keep starter
    </button>
  `);
}

// ------------------------------------
// ESPN PLAYER DATA
// ------------------------------------

async function loadESPN(force = false) {
  if (loadingESPN) return;
  if (espn && !force) return;

  loadingESPN = true;
  espnError = '';

  try {
    const response = await fetch('/api/espn/players', {
      headers: {
        Authorization: 'Bearer ' + token
      }
    });

    const result = await response.json();

    if (!response.ok) {
      throw Error(result.details || result.error);
    }

    espn = result;
  } catch (error) {
    espnError = error.message;
  } finally {
    loadingESPN = false;
    if (tab === 'Draft' || tab === 'Players') render();
  }
}

function injuryLabel(status) {
  const value = String(status || 'UNKNOWN').toUpperCase();

  if (
    value === 'QUESTIONABLE' ||
    value === 'DOUBTFUL' ||
    value === 'OUT'
  ) {
    return `<span class="pill warn">${esc(value)}</span>`;
  }

  if (value === 'ACTIVE' || value === 'HEALTHY') {
    return '<span class="pill">Healthy</span>';
  }

  return `<span class="muted small">${esc(value)}</span>`;
}

function draftData() {
  return state.draft || {
    status: 'waiting',
    rounds: 15,
    secondsPerPick: 90,
    order: [],
    picks: [],
    deadline: null
  };
}

function currentTurn() {
  const draft = draftData();
  return draft.order[draft.picks.length] || null;
}

function remainingTime() {
  const draft = draftData();

  if (draft.status === 'paused') {
    return draft.remainingSeconds || draft.secondsPerPick;
  }

  if (draft.status !== 'active' || !draft.deadline) {
    return null;
  }

  return Math.max(
    0,
    Math.ceil(
      (new Date(draft.deadline).getTime() - Date.now()) / 1000
    )
  );
}

function clockText(seconds) {
  if (seconds === null) return '--:--';

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function availablePlayers() {
  if (!espn?.players) return [];

  const selected = new Set(
    draftData().picks.map(x => String(x.playerId))
  );

  return espn.players
    .filter(x => !selected.has(String(x.id)))
    .filter(x =>
      draftPosition === 'ALL' ||
      x.position === draftPosition
    )
    .filter(x => {
      const search = draftSearch.toLowerCase();

      return (
        x.name.toLowerCase().includes(search) ||
        x.position.toLowerCase().includes(search) ||
        String(x.nflTeamId ?? '').includes(search)
      );
    })
    .sort((a, b) => {
      const rankA = a.rank ?? Infinity;
      const rankB = b.rank ?? Infinity;

      if (rankA !== rankB) return rankA - rankB;

      return (
        (a.averageDraftPosition ?? Infinity) -
        (b.averageDraftPosition ?? Infinity)
      );
    });
}

async function draftAction(action) {
  const labels = {
    start: 'Start the draft now?',
    pause: 'Pause the draft?',
    resume: 'Resume the draft?'
  };

  if (!confirm(labels[action])) return;

  try {
    await apiPost('/api/draft/' + action, {});
    toast('Draft updated');
  } catch (error) {
    toast(error.message);
  }
}

async function selectDraftPlayer(playerId) {
  const turn = currentTurn();

  if (!turn || turn.manager !== manager) {
    toast('It is not your turn');
    return;
  }

  const player = espn?.players.find(
    x => String(x.id) === String(playerId)
  );

  if (!player) return;

  if (!confirm(`Draft ${player.name}? This pick is final.`)) {
    return;
  }

  try {
    await apiPost('/api/draft/pick', {
      playerId: String(playerId)
    });

    toast(`${player.name} drafted`);
  } catch (error) {
    toast(error.message);
  }
}

function draftBoard() {
  const draft = draftData();
  const turn = currentTurn();

  if (!draft.order.length) {
    return card('Draft order', `
      <p>The commissioner has not started the draft.</p>
      <p>Registered managers: ${
        state.managers.filter(x => x.claimed).length
      } of 12</p>
    `);
  }

  const next = draft.order.slice(
    draft.picks.length,
    draft.picks.length + 12
  );

  return card('Upcoming picks', next.map((pick, index) => `
    <div class="row">
      <div>
        <b>#${draft.picks.length + index + 1}</b>
        ${esc(m(pick.manager)?.team || pick.manager)}
        <div class="muted small">
          Round ${pick.round}
        </div>
      </div>
      ${index === 0 ? '<b>ON THE CLOCK</b>' : ''}
    </div>
  `).join('') || '<p>Draft complete.</p>');
}

function draftHistory() {
  const picks = [...draftData().picks].reverse();

  return card('Draft history',
    picks.length
      ? picks.map(pick => `
        <div class="row">
          <div>
            <b>#${pick.overall} ${esc(pick.playerName)}</b>
            <div class="muted small">
              ${esc(m(pick.manager)?.team || pick.manager)}
              · ${esc(pick.position)}
              · Round ${pick.round}
              ${pick.automatic ? ' · Auto-pick' : ''}
            </div>
          </div>
          <b>${pick.rank == null ? '—' : '#' + pick.rank}</b>
        </div>
      `).join('')
      : '<p>No players drafted yet.</p>'
  );
}

function playerTable() {
  if (!espn) {
    return card('ESPN player data', `
      <p>${esc(espnError || 'Loading ESPN rankings and projections...')}</p>
      <button onclick="loadESPN(true)">Retry ESPN feed</button>
    `);
  }

  const draft = draftData();
  const turn = currentTurn();
  const myTurn =
    draft.status === 'active' &&
    turn?.manager === manager;

  const players = availablePlayers().slice(0, 250);

  const updated = espn.updatedAt
    ? new Date(espn.updatedAt).toLocaleString()
    : 'Not available';

  return card('ESPN player rankings', `
    <p class="muted small">
      Season ${esc(espn.season)} · Full PPR ·
      Updated ${esc(updated)}
      ${espn.stale ? ' · Cached data' : ''}
    </p>

    <div class="actions">
      <input
        id="draftSearch"
        placeholder="Search players"
        value="${esc(draftSearch)}"
        oninput="updateDraftSearch(this.value)"
      >
      <select
        id="draftPosition"
        onchange="updateDraftPosition(this.value)"
      >
        ${['ALL','QB','RB','WR','TE','K','D/ST'].map(pos =>
          `<option value="${pos}"
            ${draftPosition === pos ? 'selected' : ''}>
            ${pos}
          </option>`
        ).join('')}
      </select>
      <button onclick="loadESPN(true)">Refresh</button>
    </div>

    <p class="muted small">
      Showing ${players.length} available players.
      Players without an ESPN PPR rank appear last.
      Missing projections display —.
    </p>

    <div id="draftPlayerRows">
      ${players.map(player => `
        <div class="row">
          <div>
            <b>
              ${player.rank == null ? '—' : '#' + player.rank}
              ${esc(player.name)}
            </b>
            <div class="muted small">
              ${esc(player.position)}
              · ESPN ADP ${
                player.averageDraftPosition == null
                  ? '—'
                  : fmt(player.averageDraftPosition)
              }
            </div>
            ${injuryLabel(player.injuryStatus)}
          </div>
          <div style="text-align:right">
            <b>${
              player.projectedPoints == null
                ? '—'
                : fmt(player.projectedPoints)
            }</b>
            <div class="muted small">Projected PPR</div>
            ${myTurn ? `
              <button
                onclick="selectDraftPlayer('${esc(player.id)}')">
                Draft
              </button>
            ` : ''}
          </div>
        </div>
      `).join('') || '<p>No matching players.</p>'}
    </div>
  `);
}

function updateDraftSearch(value) {
  draftSearch = value;
  const input = $('draftSearch');
  const start = input?.selectionStart ?? value.length;

  render();

  const replacement = $('draftSearch');
  replacement?.focus();

  try {
    replacement?.setSelectionRange(start, start);
  } catch {}
}

function updateDraftPosition(value) {
  draftPosition = value;
  render();
}

function renderDraft() {
  const draft = draftData();
  const turn = currentTurn();

  const myTurn =
    draft.status === 'active' &&
    turn?.manager === manager;

  const commissioner = state.viewer.commissioner;

  const controls = commissioner
    ? `<div class="actions">
      ${draft.status === 'waiting'
        ? `<button onclick="draftAction('start')">
          Start draft
        </button>` : ''}
      ${draft.status === 'active'
        ? `<button onclick="draftAction('pause')">
          Pause draft
        </button>` : ''}
      ${draft.status === 'paused'
        ? `<button onclick="draftAction('resume')">
          Resume draft
        </button>` : ''}
    </div>`
    : '';

  return `
    <h1>Fantasy Audible Draft Room</h1>

    ${card('Draft status', `
      <p><b>${esc(draft.status.toUpperCase())}</b></p>
      <div class="grid">
        <div>
          <div class="muted small">Overall pick</div>
          <h2>${draft.picks.length + 1} / ${
            draft.order.length || 'Not started'
          }</h2>
        </div>
        <div>
          <div class="muted small">Pick timer</div>
          <h2 id="draftClock">${clockText(remainingTime())}</h2>
        </div>
      </div>

      <p>
        ${
          turn
            ? `On the clock: <b>${
                esc(m(turn.manager)?.team || turn.manager)
              }</b>`
            : draft.status === 'completed'
            ? 'All draft selections are complete.'
            : 'Waiting for commissioner.'
        }
      </p>

      ${myTurn
        ? '<p><b>Your turn! Select a player below.</b></p>'
        : ''}

      ${controls}
    `)}

    ${draftBoard()}
    ${playerTable()}
    ${draftHistory()}
  `;
}

// ------------------------------------
// MAIN PAGES
// ------------------------------------

function render() {
  if (!state || !manager) return;

  const mine = state.players.filter(x => x.owner === manager);
  const myTeam = m(manager);

  if (!myTeam) return;

  $('tabs').innerHTML = tabs
    .filter(t =>
      t !== 'Commissioner' ||
      state.viewer.commissioner
    )
    .map(t => `
      <button
        class="${tab === t ? 'active' : ''}"
        onclick="changeTab('${t}')">
        ${t}
      </button>
    `)
    .join('');

  let content = '';

  if (tab === 'Home') {
    content = `
      <h1>${esc(state.league)}</h1>
      <p>Week ${state.week} · ${esc(myTeam.team)}</p>

      <div class="grid">
        ${card('Your score',
          `<div class="stat">${fmt(total(manager))}</div>`)}
        ${card('Registered teams',
          `<div class="stat">${
            state.managers.filter(x => x.claimed).length
          } / 12</div>`)}
        ${card('Draft status',
          `<p>${esc(draftData().status)}</p>
           <button onclick="changeTab('Draft')">
             Open draft room
           </button>`)}
      </div>

      ${state.injuries
        .filter(i => i.active)
        .map(injuryCard)
        .join('')}

      ${card('Recent activity',
        state.transactions.slice(0, 8)
          .map(t => `<div class="row">
            <span>${esc(t.details)}</span>
          </div>`)
          .join('') || '<p>No activity yet.</p>')}
    `;
  }

  if (tab === 'My Team') {
    const picks = draftData().picks
      .filter(x => x.manager === manager);

    content = `
      <h1>${esc(myTeam.team)}</h1>
      <button onclick="renameTeam()">Rename My Team</button>

      ${card('Drafted players',
        picks.map(x => `<div class="row">
          <div>
            <b>${esc(x.playerName)}</b>
            <div class="muted small">
              ${esc(x.position)} · Pick ${x.overall}
            </div>
          </div>
          <b>${
            x.projectedPoints == null
              ? '—'
              : fmt(x.projectedPoints)
          }</b>
        </div>`).join('') || '<p>No draft picks yet.</p>')}

      ${state.injuries
        .filter(i => i.active)
        .map(injuryCard)
        .join('')}

      ${card('Starting lineup',
        mine.filter(x => x.slot !== 'BENCH')
          .map(playerRow).join('') ||
        '<p>No starters assigned.</p>')}

      ${card('Bench',
        mine.filter(x => x.slot === 'BENCH')
          .map(playerRow).join('') ||
        '<p>No bench players assigned.</p>')}
    `;
  }

  if (tab === 'Matchup') {
    const opponent = manager === 'm1' ? 'm2' : 'm1';

    content = `
      <h1>Week ${state.week} Matchup</h1>
      <div class="grid">
        ${card(esc(myTeam.team),
          `<div class="stat">${fmt(total(manager))}</div>
           ${mine.filter(x => x.slot !== 'BENCH')
             .map(playerRow).join('')}`)}
        ${m(opponent) ? card(esc(m(opponent).team),
          `<div class="stat">${fmt(total(opponent))}</div>
           ${state.players.filter(x =>
             x.owner === opponent && x.slot !== 'BENCH'
           ).map(playerRow).join('')}`) : ''}
      </div>
    `;
  }

  if (tab === 'League') {
    content = `
      <h1>League</h1>
      ${card('Teams',
        state.managers.filter(x => x.claimed)
          .map(x => `<div class="row">
            <b>${esc(x.team)}</b>
            <span>${fmt(total(x.id))} pts</span>
          </div>`).join(''))}
    `;
  }

  if (tab === 'Players') {
    content = `
      <h1>ESPN Player Directory</h1>
      ${playerTable()}
    `;
  }

  if (tab === 'Draft') {
    content = renderDraft();
  }

  if (tab === 'Notifications') {
    content = `
      <h1>Notifications</h1>
      ${card('Injury alerts',
        state.injuries.map(i => `
          <div class="row">
            <b>${esc(p(i.player)?.name || 'Player')}</b>
            <span>${i.active ? 'Pending' : 'Resolved'}</span>
          </div>
        `).join('') || '<p>No alerts.</p>')}

      ${card('Transactions',
        state.transactions.slice(0, 50)
          .map(t => `<div class="row">
            ${esc(t.details)}
          </div>`).join('') || '<p>No transactions.</p>')}
    `;
  }

  if (tab === 'Commissioner' &&
      state.viewer.commissioner) {
    content = `
      <h1>Commissioner Controls</h1>

      ${card('Draft management', `
        <p>Manage the snake draft.</p>
        <button onclick="changeTab('Draft')">
          Open draft controls
        </button>
      `)}

      ${card('Simulate injury', `
        <select id="injuryPlayer">
          ${state.players
            .filter(x => x.slot !== 'BENCH')
            .map(x => `<option value="${esc(x.id)}">
              ${esc(x.name)}
            </option>`).join('')}
        </select>
        <button onclick="act('/api/demo',{
          action:'injure',
          player:$('injuryPlayer').value
        })">Trigger injury</button>
      `)}

      ${card('Advance game window', `
        <p>Current phase: ${state.phase}</p>
        <button onclick="act('/api/demo',{
          action:'advance'
        })">Advance</button>
      `)}

      ${card('Simulate points', `
        <select id="pointPlayer">
          ${state.players.map(x =>
            `<option value="${esc(x.id)}">
              ${esc(x.name)}
            </option>`
          ).join('')}
        </select>
        <button onclick="act('/api/demo',{
          action:'points',
          player:$('pointPlayer').value,
          amount:3.5
        })">Add 3.5 points</button>
      `)}
    `;
  }

  $('app').innerHTML = `
    <div class="row">
      <span class="muted small">
        ${esc(state.viewer.name)} · ${esc(myTeam.team)}
      </span>
      <div class="actions">
        <button onclick="renameTeam()">Rename Team</button>
        <button onclick="logout()">Sign out</button>
      </div>
    </div>
    ${content}
  `;
}

function changeTab(next) {
  tab = next;
  render();

  if (tab === 'Draft' || tab === 'Players') {
    loadESPN();
  }
}

function logout() {
  localStorage.removeItem('audibleToken');
  location.reload();
}

// ------------------------------------
// REGISTRATION / LOGIN
// ------------------------------------

function authForm() {
  $('tabs').innerHTML = '';
  $('connection').textContent = '● Sign in';

  $('app').innerHTML = `
    <section class="card" style="max-width:500px;margin:auto">
      <h1>Fantasy Audible</h1>
      <p>Create your own fantasy team.</p>

      <form id="auth">
        <input id="email"
          type="email" required
          placeholder="Email"
          style="width:100%;padding:12px;margin:6px 0">

        <input id="password"
          type="password" required minlength="10"
          placeholder="Password (10+ characters)"
          style="width:100%;padding:12px;margin:6px 0">

        <label for="teamName">
          Fantasy team name (new accounts)
        </label>

        <input id="teamName"
          type="text" minlength="3" maxlength="40"
          placeholder="Your custom team name"
          style="width:100%;padding:12px;margin:6px 0">

        <div class="actions">
          <button type="submit">Sign in</button>
          <button type="button" id="register">
            Create Account
          </button>
        </div>

        <p id="authError" role="alert"></p>
      </form>
    </section>
  `;

  async function submit(kind) {
    try {
      const body = {
        email: $('email').value,
        password: $('password').value
      };

      if (kind === 'register') {
        body.teamName = $('teamName').value.trim();

        if (
          body.teamName.length < 3 ||
          body.teamName.length > 40
        ) {
          throw Error('Team name must be 3–40 characters');
        }
      }

      const response = await fetch('/api/' + kind, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const result = await response.json();

      if (!response.ok) {
        throw Error(result.error || 'Authentication failed');
      }

      localStorage.setItem('audibleToken', result.token);
      location.reload();

    } catch (error) {
      $('authError').textContent = error.message;
    }
  }

  $('auth').onsubmit = event => {
    event.preventDefault();
    submit('login');
  };

  $('register').onclick = () => submit('register');
}

// ------------------------------------
// LIVE CONNECTION
// ------------------------------------

async function connect() {
  if (!token) return authForm();

  try {
    const response = await fetch('/api/state', {
      headers: {
        Authorization: 'Bearer ' + token
      }
    });

    if (response.status === 401) return logout();

    if (!response.ok) {
      throw Error('Server unavailable');
    }

    state = await response.json();
    manager = state.viewer.manager;

    render();

  } catch (error) {
    $('connection').textContent = '● Offline';
    return;
  }

  const events = new EventSource(
    '/api/events?token=' + encodeURIComponent(token)
  );

  events.onmessage = event => {
    state = JSON.parse(event.data);
    manager = state.viewer.manager;

    $('connection').textContent = '● Live synced';

    render();
  };

  events.onerror = () => {
    $('connection').textContent = '● Reconnecting…';
  };
}

// Update countdown without re-rendering the draft board.
setInterval(() => {
  if (tab !== 'Draft') return;

  const clock = $('draftClock');

  if (clock) {
    clock.textContent = clockText(remainingTime());
  }
}, 500);

connect();
