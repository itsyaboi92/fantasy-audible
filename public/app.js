
let state = null;
let tab = 'Home';
let manager = null;
let token = localStorage.getItem('audibleToken');

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

const $ = id => document.getElementById(id);
const p = id => state.players.find(x => x.id === id);
const m = id => state.managers.find(x => x.id === id);
const fmt = n => Number(n || 0).toFixed(1);

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').style.display = 'block';
  setTimeout(() => {
    $('toast').style.display = 'none';
  }, 3500);
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

function playerRow(x) {
  return `
    <div class="row">
      <div>
        <b>${escapeHTML(x.name)}</b>
        <div class="muted small">
          ${escapeHTML(x.team)} ·
          ${escapeHTML(x.pos)} ·
          ${escapeHTML(x.slot)} ·
          ${escapeHTML(x.status)}
        </div>
      </div>
      <b>${fmt(score(x))}</b>
    </div>
  `;
}

function card(title, body, extra = '') {
  return `
    <section class="card ${extra}">
      <h2>${title}</h2>
      ${body}
    </section>
  `;
}

async function renameTeam() {
  if (!state || !manager) return;

  const current = m(manager)?.team || '';
  const proposed = prompt(
    'Enter your new fantasy team name:',
    current
  );

  if (proposed === null) return;

  const name = proposed.trim().replace(/\s+/g, ' ');

  if (name === current) return;

  if (name.length < 3 || name.length > 40) {
    toast('Team name must be 3–40 characters.');
    return;
  }

  try {
    const response = await fetch('/api/team-name', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ name })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Rename failed');
    }

    toast('Team renamed to ' + result.team);

    // Update immediately; server events sync other devices.
    const team = m(manager);
    if (team) team.team = result.team;
    render();

  } catch (error) {
    toast(error.message);
  }
}

function injuryCard(i) {
  const starter = p(i.player);

  if (!starter || starter.owner !== manager) {
    return '';
  }

  const choices = state.players
    .filter(x =>
      x.owner === manager &&
      x.slot === 'BENCH' &&
      x.pos === starter.pos
    )
    .map(x => {
      const mode =
        x.team === starter.team &&
        x.kickoff <= state.phase
          ? 'Handcuff — prior points zeroed'
          : x.kickoff > state.phase
            ? 'Later kickoff — full score'
            : null;

      return `
        <div class="row">
          <div>
            <b>${escapeHTML(x.name)}</b>
            <div class="muted small">
              ${mode || 'Game already started — locked'}
            </div>
          </div>
          <button
            ${mode ? '' : 'disabled'}
            onclick="act('/api/substitute',{
              injury:'${i.id}',
              bench:'${x.id}'
            })">
            Substitute
          </button>
        </div>
      `;
    })
    .join('');

  return card(
    '🚨 Injury substitution available',
    `
      <p>
        ${escapeHTML(starter.name)} ·
        ${escapeHTML(starter.pos)} ·
        ${fmt(starter.points)} pts.
        Keep the current score or replace him with
        an eligible bench player.
      </p>
      ${choices || '<p>No matching bench players.</p>'}
      <div class="actions">
        <button onclick="act('/api/keep',{injury:'${i.id}'})">
          Keep starter
        </button>
      </div>
    `,
    'highlight'
  );
}

function render() {
  if (!state || !manager) return;

  const myTeam = m(manager);
  if (!myTeam) return;

  const mine = state.players.filter(x => x.owner === manager);

  $('tabs').innerHTML = tabs
    .filter(t =>
      t !== 'Commissioner' ||
      state.viewer.commissioner
    )
    .map(t => `
      <button
        class="${tab === t ? 'active' : ''}"
        onclick="tab='${t}';render()">
        ${t}
      </button>
    `)
    .join('');

  let content = '';

  if (tab === 'Home') {
    content = `
      <h1>${escapeHTML(state.league)}</h1>
      <p>
        Week ${state.week} ·
        ${escapeHTML(myTeam.team)} ·
        Live shared league
      </p>

      <div class="grid">
        ${card(
          'Your live score',
          `
            <div class="stat">${fmt(total(manager))}</div>
            <p>Points from active starters</p>
          `
        )}

        ${card(
          'League managers',
          `
            <div class="stat">${state.managers.length}</div>
            <p>Connected through one shared server</p>
          `
        )}

        ${card(
          'Pending injuries',
          `
            <div class="stat">
              ${
                state.injuries.filter(i =>
                  i.active &&
                  p(i.player)?.owner === manager
                ).length
              }
            </div>
            <p>Action required</p>
          `
        )}
      </div>

      ${state.injuries
        .filter(i => i.active)
        .map(injuryCard)
        .join('')}

      ${card(
        'Recent activity',
        state.transactions
          .slice(0, 5)
          .map(t => `
            <div class="row">
              <span>${escapeHTML(t.details)}</span>
              <span class="muted small">
                ${new Date(t.at).toLocaleTimeString()}
              </span>
            </div>
          `)
          .join('') || '<p>No transactions yet.</p>'
      )}
    `;
  }

  if (tab === 'My Team') {
    content = `
      <h1>${escapeHTML(myTeam.team)}</h1>

      <div class="actions">
        <button onclick="renameTeam()">
          ✏️ Rename My Team
        </button>
      </div>

      <p>
        Manage your team. Changes synchronize
        across connected devices.
      </p>

      ${state.injuries
        .filter(i => i.active)
        .map(injuryCard)
        .join('')}

      ${card(
        'Starting lineup',
        mine
          .filter(x => x.slot !== 'BENCH')
          .map(playerRow)
          .join('') || '<p>No starters assigned.</p>'
      )}

      ${card(
        'Bench',
        mine
          .filter(x => x.slot === 'BENCH')
          .map(playerRow)
          .join('') || '<p>No bench players assigned.</p>'
      )}
    `;
  }

  if (tab === 'Matchup') {
    const opponent = manager === 'm1' ? 'm2' : 'm1';
    const opponentTeam = m(opponent);

    content = `
      <h1>Week ${state.week} Matchup</h1>

      <div class="grid">
        ${card(
          escapeHTML(myTeam.team),
          `
            <div class="score">${fmt(total(manager))}</div>
            ${mine
              .filter(x => x.slot !== 'BENCH')
              .map(playerRow)
              .join('')}
          `
        )}

        ${opponentTeam
          ? card(
              escapeHTML(opponentTeam.team),
              `
                <div class="score">${fmt(total(opponent))}</div>
                ${state.players
                  .filter(x =>
                    x.owner === opponent &&
                    x.slot !== 'BENCH'
                  )
                  .map(playerRow)
                  .join('')}
              `
            )
          : ''}
      </div>
    `;
  }

  if (tab === 'League') {
    const standings = state.managers
      .slice()
      .sort((a, b) => total(b.id) - total(a.id));

    content = `
      <h1>League standings</h1>
      <p>Demo standings ranked by current lineup points.</p>

      ${card(
        'Live leaderboard',
        standings.map((x, i) => `
          <div class="row">
            <div>
              <b>${i + 1}. ${escapeHTML(x.team)}</b>
              <div class="muted small">
                ${escapeHTML(x.name)}
              </div>
            </div>
            <b>${fmt(total(x.id))}</b>
          </div>
        `).join('')
      )}
    `;
  }

  if (tab === 'Players') {
    content = `
      <h1>Player pool</h1>
      <p>
        Demo player directory. Waivers and trades
        require additional backend workflows.
      </p>

      ${card(
        'League players',
        state.players.map(x => `
          <div class="row">
            <div>
              <b>${escapeHTML(x.name)}</b>
              <div class="muted small">
                ${escapeHTML(x.team)} ·
                ${escapeHTML(x.pos)} ·
                ${escapeHTML(m(x.owner)?.team || '')}
              </div>
            </div>
            <b>${fmt(score(x))}</b>
          </div>
        `).join('')
      )}
    `;
  }

  if (tab === 'Draft') {
    content = `
      <h1>Draft room</h1>

      ${card(
        'Draft module',
        `
          <p>
            Draft room layout is ready for development.
            Real-time pick clocks, draft orders,
            pick validation and draft history
            are not implemented yet.
          </p>
          <button disabled>Start draft</button>
        `
      )}
    `;
  }

  if (tab === 'Notifications') {
    content = `
      <h1>Notifications</h1>

      ${card(
        'Injury alerts',
        state.injuries.map(i => `
          <div class="row">
            <div>
              <b>${escapeHTML(p(i.player)?.name || 'Player')}</b>
              <div class="muted small">
                ${escapeHTML(i.description)}
              </div>
            </div>
            <span class="pill ${i.active ? 'warn' : ''}">
              ${i.active ? 'Pending' : 'Resolved'}
            </span>
          </div>
        `).join('')
      )}

      ${card(
        'Transaction feed',
        state.transactions.map(t => `
          <div class="row">
            <div>
              ${escapeHTML(t.details)}
              <div class="muted small">
                ${new Date(t.at).toLocaleString()}
              </div>
            </div>
          </div>
        `).join('') || '<p>No transactions.</p>'
      )}
    `;
  }

  if (
    tab === 'Commissioner' &&
    state.viewer.commissioner
  ) {
    content = `
      <h1>Commissioner demo controls</h1>

      <p>
        These controls simulate NFL events for testing.
        They require commissioner permissions.
      </p>

      ${card(
        'Simulate injury',
        `
          <select id="injuryPlayer">
            ${state.players
              .filter(x => x.slot !== 'BENCH')
              .map(x => `
                <option value="${x.id}">
                  ${escapeHTML(x.name)}
                  (${escapeHTML(m(x.owner)?.team || '')})
                </option>
              `).join('')}
          </select>

          <div class="actions">
            <button onclick="act('/api/demo',{
              action:'injure',
              player:$('injuryPlayer').value
            })">
              Trigger injury
            </button>
          </div>
        `
      )}

      ${card(
        'Advance game window',
        `
          <p>
            Current demo phase: ${state.phase}.
            Later kickoff players become locked
            when their phase begins.
          </p>

          <button
            onclick="act('/api/demo',{action:'advance'})"
            ${state.phase >= 4 ? 'disabled' : ''}>
            Advance kickoff window
          </button>
        `
      )}

      ${card(
        'Simulate player scoring',
        `
          <select id="pointPlayer">
            ${state.players.map(x => `
              <option value="${x.id}">
                ${escapeHTML(x.name)}
              </option>
            `).join('')}
          </select>

          <div class="actions">
            <button onclick="act('/api/demo',{
              action:'points',
              player:$('pointPlayer').value,
              amount:3.5
            })">
              Add 3.5 points
            </button>
          </div>

          <p class="small">
            Handcuff scores only count points
            earned after substitution.
          </p>
        `
      )}
    `;
  }

  $('app').innerHTML = `
    <div class="row">
      <span class="muted small">
        Signed in:
        ${escapeHTML(state.viewer.name)} ·
        ${escapeHTML(myTeam.team)}
      </span>

      <div class="actions">
        <button onclick="renameTeam()">
          Rename Team
        </button>

        <button onclick="logout()">
          Sign out
        </button>
      </div>
    </div>

    ${content}
  `;
}

async function act(url, body) {
  if (
    url === '/api/substitute' &&
    !confirm(
      'Confirm permanent substitution? Previous starter points will be forfeited.'
    )
  ) {
    return;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(body)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Action failed');
    }

    toast('League updated on all connected screens');

  } catch (error) {
    toast(error.message);
  }
}

function logout() {
  localStorage.removeItem('audibleToken');
  location.reload();
}

async function authForm() {
  const response = await fetch('/api/teams');
  const teams = await response.json();

  $('tabs').innerHTML = '';
  $('connection').textContent = '● Sign in';

  const available = teams.filter(x => !x.claimed);

  $('app').innerHTML = `
    <section
      class="card"
      style="max-width:500px;margin:auto"
    >
      <h1>Fantasy Audible</h1>

      <p>
        Create an account or sign in to manage
        only your own team.
      </p>

      <form id="auth">
        <input
          id="email"
          type="email"
          required
          placeholder="Email"
          style="width:100%;padding:12px;margin:6px 0"
        >

        <input
          id="password"
          type="password"
          required
          minlength="10"
          placeholder="Password (10+ characters)"
          style="width:100%;padding:12px;margin:6px 0"
        >

        <select
          id="team"
          style="width:100%;margin:6px 0"
        >
          ${available.map(x => `
            <option value="${x.id}">
              ${escapeHTML(x.team)}
            </option>
          `).join('')}
        </select>

        <div class="actions">
          <button type="submit" id="login">
            Sign in
          </button>

          <button
            type="button"
            id="register"
            ${available.length ? '' : 'disabled'}
          >
            Register and claim selected team
          </button>
        </div>

        <p id="authError" role="alert"></p>
      </form>
    </section>
  `;

  async function submit(kind) {
    try {
      const response = await fetch('/api/' + kind, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: $('email').value,
          password: $('password').value,
          manager: $('team').value
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Authentication failed');
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

async function connect() {
  if (!token) {
    return authForm();
  }

  try {
    const response = await fetch('/api/state', {
      headers: {
        Authorization: 'Bearer ' + token
      }
    });

    if (!response.ok) {
      logout();
      return;
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

connect();
