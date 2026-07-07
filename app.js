// ============ STATE ============
const state = {
  nickname: null,
  myCharacter: null,       // character_tab del personaggio del giocatore loggato
  viewingCharacter: null,  // character_tab attualmente mostrato
  isOwner: false,
  creationMode: false,
  data: null,              // ultimo dump ricevuto dal backend
  changes: []              // modifiche pendenti da salvare: {block,row,col,value}
};

const LABELS = {
  anagrafica: ['Nome','Nazionalità','Employer','Professione','Sesso','Età','Education and Occupational History'],
  statistiche: ['Strenght (STR)','Constitution (CON)','Dexterity (DEX)','Intelligence (INT)','WillPower (POW)','Charisma (CHA)'],
  derived: ['Luck (LK)','Hit Point (HP)','Willpower Point (WP)','Sanity Point (SAN)','Breaking Point (BP)']
};

// ============ API HELPERS ============
function apiGet(params) {
  const url = new URL(CONFIG.APPS_SCRIPT_URL);
  Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
  return fetch(url).then(r => r.json());
}
function apiPost(body) {
  // niente header Content-Type -> evita il preflight CORS con Apps Script
  return fetch(CONFIG.APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(body) })
    .then(r => r.json());
}

// ============ LOGIN ============
const loginScreen = document.getElementById('loginScreen');
const appScreen = document.getElementById('appScreen');

function tryAutoLogin() {
  const saved = localStorage.getItem('phenomena_session');
  if (saved) {
    const { nickname, character_tab } = JSON.parse(saved);
    state.nickname = nickname;
    state.myCharacter = character_tab;
    enterApp();
  }
}

document.getElementById('loginBtn').addEventListener('click', doLogin);
document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

function doLogin() {
  const nickname = document.getElementById('loginNickname').value.trim();
  const password = document.getElementById('loginPassword').value;
  const remember = document.getElementById('rememberMe').checked;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';

  if (!nickname || !password) { errEl.textContent = 'Inserisci nickname e password'; return; }

  apiGet({ action: 'login', nickname, password }).then(res => {
    if (!res.ok) { errEl.textContent = res.error || 'Login fallito'; return; }
    state.nickname = res.nickname;
    state.myCharacter = res.character_tab;
    if (remember) {
      localStorage.setItem('phenomena_session', JSON.stringify({ nickname: res.nickname, character_tab: res.character_tab }));
    }
    enterApp();
  }).catch(() => { errEl.textContent = 'Errore di connessione al backend'; });
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('phenomena_session');
  location.reload();
});

// ============ APP BOOT ============
function enterApp() {
  loginScreen.style.display = 'none';
  appScreen.style.display = 'flex';

  apiGet({ action: 'listCharacters' }).then(res => {
    const select = document.getElementById('charSelect');
    select.innerHTML = '';
    res.characters.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.character_tab;
      opt.textContent = c.character_tab + (c.character_tab === state.myCharacter ? ' (tu)' : '');
      select.appendChild(opt);
    });
    select.value = state.myCharacter;
    loadCharacter(state.myCharacter);
  });

  document.getElementById('charSelect').addEventListener('change', e => loadCharacter(e.target.value));
}

function loadCharacter(characterTab) {
  state.viewingCharacter = characterTab;
  state.changes = [];
  updateSaveStatus('');

  apiGet({ action: 'getFull', character: characterTab, nickname: state.nickname }).then(res => {
    if (!res.ok) { alert(res.error); return; }
    state.data = res.data;
    state.isOwner = res.owner;
    document.getElementById('readOnlyBanner').style.display = state.isOwner ? 'none' : 'block';
    document.getElementById('creationMode').disabled = !state.isOwner;
    renderHomeSheet();
    renderAccordion();
    renderStickyHeader();
  });
}

// ============ TABS ============
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.view).classList.add('active');
  });
});

// ============ HOME SHEET (struttura dati semantica, allineata ai token Figma) ============
function esc(v) {
  const s = (v ?? '').toString();
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
const val = (v) => `<span class="ph-valbox">${esc(v)}</span>`;
function isChecked(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1;
}

function renderHomeSheet() {
  const d = state.data;
  const el = document.getElementById('phSheet');

  const [name, nationality, employer, profession, sex, age, education] = d.anagrafica.map(r => r[1]);
  const [str_, con_, dex_, int_, pow_, cha_] = d.statistiche.map(r => r[1]);
  const der = d.derived; // [ [label,max,current], ... ] ordine: Luck,HP,WP,SAN,BP

  // Skills: 44 righe totali, divise in 3 colonne come nel foglio originale (15 / 15 / 14)
  const skills = d.skills;
  const col1 = skills.slice(0, 15);
  const col2 = skills.slice(15, 30);
  const col3 = skills.slice(30, 44);

  const skillRowHtml = (row) => {
    const [key, name, stat, base, checked, bonus, total, param] = row;
    if (!name) return '';
    const isOn = isChecked(checked);
    const displayName = param ? `${name} (${param})` : name;
    const chip = stat ? `<span class="ph-skill-chip">${esc(stat)}</span>` : '<span class="ph-skill-chip ph-skill-chip-empty">—</span>';
    return `
      <div class="ph-skill-row">
        <span class="ph-checkbox-box ${isOn ? 'on' : ''}"></span>
        <span class="ph-skill-name">${esc(displayName)}</span>
        ${chip}
        <span class="ph-skill-val ph-skill-base">${esc(base)}</span>
        <span class="ph-skill-val ph-skill-bonus">${esc(bonus)}</span>
        <span class="ph-skill-val ph-skill-total">${esc(total)}</span>
      </div>`;
  };

  const bondRowHtml = (row) => `
    <div class="ph-list-row">
      <span class="ph-list-text">${esc(row[0])}</span>
      ${val(row[1])}
    </div>`;

  el.innerHTML = `
    <div class="ph-titlebar">PHENOMENA!</div>

    <div class="ph-block ph-header-block">
      <div class="ph-anagrafica-layout">
        <div class="ph-photo-placeholder" id="phPhotoBox">
          <img src="photos/${encodeURIComponent(state.viewingCharacter)}.jpg"
               alt="Foto personaggio" class="ph-photo-img"
               onerror="this.parentElement.innerHTML = document.getElementById('phPhotoFallback').innerHTML;">
        </div>
        <template id="phPhotoFallback">
          <svg viewBox="0 0 80 100" class="ph-photo-icon">
            <rect x="1" y="1" width="78" height="98" fill="none" stroke="#000" stroke-width="1"/>
            <circle cx="40" cy="36" r="16" fill="#d9d9d9" stroke="#000"/>
            <path d="M12 92 Q12 60 40 60 Q68 60 68 92 Z" fill="#d9d9d9" stroke="#000"/>
          </svg>
          <span class="ph-photo-label">FOTO</span>
        </template>
        <div class="ph-anagrafica-fields">
          <div class="ph-row">
            <div class="ph-field ph-name"><span class="ph-label">Name</span><span class="ph-value">${esc(name)}</span></div>
          </div>
          <div class="ph-row">
            <div class="ph-field ph-nationality"><span class="ph-label">Nationality</span><span class="ph-value">${esc(nationality)}</span></div>
          </div>
          <div class="ph-row">
            <div class="ph-field ph-sex"><span class="ph-label">Sex</span><span class="ph-value">${esc(sex)}</span></div>
            <div class="ph-field ph-age"><span class="ph-label">Age</span><span class="ph-value">${esc(age)}</span></div>
          </div>
        </div>
      </div>
      <div class="ph-row">
        <div class="ph-field ph-employer"><span class="ph-label">Employer</span><span class="ph-value">${esc(employer)}</span></div>
        <div class="ph-field ph-profession"><span class="ph-label">Profession</span><span class="ph-value">${esc(profession)}</span></div>
      </div>
      <div class="ph-field ph-education"><span class="ph-label">Education and Occupational History</span><span class="ph-value">${esc(education)}</span></div>
    </div>

    <div class="ph-block ph-statistics">
      <div class="ph-block-title">Statistics</div>
      <div class="ph-stat-row ph-stat-header-row"><span></span><span>Score</span><span>X 5</span></div>
      ${[['Strenght (STR)',str_],['Constitution (CON)',con_],['Dexterity (DEX)',dex_],
         ['Intelligence (INT)',int_],['WillPower (POW)',pow_],['Charisma (CHA)',cha_]]
        .map(([l,v]) => `<div class="ph-stat-row"><span class="ph-stat-label">${l}</span>${val(v)}${val((parseInt(v)||0)*5)}</div>`).join('')}
    </div>

    <div class="ph-block ph-derived">
      <div class="ph-block-title">Derived Attributes</div>
      <div class="ph-derived-row ph-derived-header-row"><span></span><span>Maximum</span><span>Current</span></div>
      ${der.map(r => `<div class="ph-derived-row"><span class="ph-derived-label">${esc(r[0])}</span>${val(r[1])}${val(r[2])}</div>`).join('')}
    </div>

    <div class="ph-block ph-violence">
      <span class="ph-violence-group"><span class="ph-label">Violence</span> ${[0,1,2].map(i => `<span class="ph-checkbox-box ph-checkbox-green ${isChecked(d.violence[i]) ? 'on' : ''}"></span>`).join(' ')}</span>
      <span class="ph-helplessness-group"><span class="ph-label">Helplessness</span> ${[3,4,5].map(i => `<span class="ph-checkbox-box ph-checkbox-green ${isChecked(d.violence[i]) ? 'on' : ''}"></span>`).join(' ')}</span>
    </div>

    <div class="ph-block ph-skills">
      <div class="ph-block-title">Applicable Skill Sets</div>
      <div class="ph-skills-legend">Accademics/Science: INT or INT+B/3 &nbsp;·&nbsp; Craft/Tech / Pilot: DEX &nbsp;·&nbsp; Language: CHA</div>
      <div class="ph-skills-columns">
        <div class="ph-skills-col ph-skills-col-1">${col1.map(skillRowHtml).join('')}</div>
        <div class="ph-skills-col ph-skills-col-2">${col2.map(skillRowHtml).join('')}</div>
        <div class="ph-skills-col ph-skills-col-3">${col3.map(skillRowHtml).join('')}</div>
      </div>
    </div>

    <div class="ph-block ph-bonds">
      <div class="ph-block-title">Bonds <span class="ph-block-title-right">Score</span></div>
      ${d.bonds.map(bondRowHtml).join('')}
    </div>
    <div class="ph-block ph-contacts">
      <div class="ph-block-title">Contacts <span class="ph-block-title-right">Score</span></div>
      ${d.contacts.map(bondRowHtml).join('')}
    </div>

    <div class="ph-block ph-armor-gears">
      <div class="ph-block-title">Armor and Gears</div>
      <div class="ph-gear-list">
        ${d.gear.filter(r => (r[0]??'').toString().trim()).map(r => `<span class="ph-gear-item">${esc(r[0])}</span>`).join('')}
      </div>
    </div>

    <div class="ph-block ph-weapons">
      <div class="ph-block-title">Weapons</div>
      <div class="ph-weapons-header">
        <span>Weapon</span><span>Skill%</span><span>Range</span><span>Damage</span>
        <span>Armor Piercing</span><span>Lethality%</span><span>Kill Radius</span><span>Ammo</span>
      </div>
      ${d.weapons.map(row => `
        <div class="ph-weapons-row">
          ${row.map(v => `<span>${esc(v)}</span>`).join('')}
        </div>`).join('')}
    </div>
  `;
}

function renderStickyHeader() {
  const a = state.data.anagrafica.map(r => r[1]);
  const der = state.data.derived;
  document.getElementById('stickyName').textContent = (a[0] || 'Senza nome') + (state.isOwner ? '' : ' (sola lettura)');
  document.getElementById('stickyMeta').textContent = `${a[3] || '—'} · ${a[5] || '—'} anni`;
  document.getElementById('stickyStats').innerHTML = `
    <span>HP <b>${der[1][2] ?? '-'}</b>/${der[1][1] ?? '-'}</span>
    <span>SAN <b>${der[3][2] ?? '-'}</b>/${der[3][1] ?? '-'}</span>
    <span>WP <b>${der[2][2] ?? '-'}</b>/${der[2][1] ?? '-'}</span>
  `;
}

// ============ ACCORDION ============
function toggleAcc(head) { head.parentElement.classList.toggle('open'); }

function fieldHtml(block, row, col, label, value, lockedUnlessCreation) {
  const disabled = lockedUnlessCreation && !state.creationMode ? 'disabled' : (!state.isOwner ? 'disabled' : '');
  const lockedClass = lockedUnlessCreation ? 'locked' : '';
  return `<div class="field ${lockedClass}">
    <label>${label}</label>
    <input type="text" value="${value ?? ''}" ${disabled}
      data-block="${block}" data-row="${row}" data-col="${col}">
  </div>`;
}

function renderAccordion() {
  const d = state.data;
  const acc = document.getElementById('accordion');
  acc.innerHTML = `

    <div class="acc-item open">
      <div class="acc-head" onclick="toggleAcc(this)"><span>Anagrafica</span><span class="chev">▶</span></div>
      <div class="acc-body">
        <div class="field-row">
          ${fieldHtml('anagrafica',1,2,'Nome', d.anagrafica[0][1], true)}
          ${fieldHtml('anagrafica',2,2,'Nazionalità', d.anagrafica[1][1], true)}
        </div>
        <div class="field-row">
          ${fieldHtml('anagrafica',3,2,'Employer', d.anagrafica[2][1], true)}
          ${fieldHtml('anagrafica',4,2,'Professione', d.anagrafica[3][1], true)}
        </div>
        <div class="field-row">
          ${fieldHtml('anagrafica',5,2,'Sesso', d.anagrafica[4][1], true)}
          ${fieldHtml('anagrafica',6,2,'Età', d.anagrafica[5][1], true)}
        </div>
        ${fieldHtml('anagrafica',7,2,'Education and Occupational History', d.anagrafica[6][1], true)}
      </div>
    </div>

    <div class="acc-item">
      <div class="acc-head" onclick="toggleAcc(this)"><span>Statistiche</span><span class="chev">▶</span></div>
      <div class="acc-body">
        <div class="field-row">
          ${LABELS.statistiche.slice(0,3).map((l,i) => fieldHtml('statistiche',i+1,2,l,d.statistiche[i][1],true)).join('')}
        </div>
        <div class="field-row">
          ${LABELS.statistiche.slice(3,6).map((l,i) => fieldHtml('statistiche',i+4,2,l,d.statistiche[i+3][1],true)).join('')}
        </div>
        <hr style="margin:10px 0;border:none;border-top:1px solid #ccc;">
        ${LABELS.derived.map((l,i) => `
          <div class="field-row">
            ${fieldHtml('derived',i+1,3,l+' — attuale', d.derived[i][2], false)}
            ${fieldHtml('derived',i+1,2,l+' — massimo', d.derived[i][1], true)}
          </div>`).join('')}
        <div class="field-row">
          <div class="field">
            <label>Violence</label>
            ${[2,3,4].map(c => `<input type="checkbox" data-block="violence" data-row="1" data-col="${c}" ${isChecked(d.violence[c-2])?'checked':''} ${state.isOwner?'':'disabled'}>`).join(' ')}
          </div>
          <div class="field">
            <label>Helplessness</label>
            ${[6,7,8].map(c => `<input type="checkbox" data-block="violence" data-row="1" data-col="${c}" ${isChecked(d.violence[c-3])?'checked':''} ${state.isOwner?'':'disabled'}>`).join(' ')}
          </div>
        </div>
      </div>
    </div>

    <div class="acc-item">
      <div class="acc-head" onclick="toggleAcc(this)"><span>Bonds &amp; Contacts</span><span class="chev">▶</span></div>
      <div class="acc-body">
        <div class="skill-cat">Bonds</div>
        ${d.bonds.map((row,i) => `
          <div class="field-row">
            ${fieldHtml('bonds',i+1,1,'Nome / info', row[0], true)}
            <div class="field" style="max-width:70px">
              <label>Score</label>
              <input type="number" value="${row[1] ?? ''}" data-block="bonds" data-row="${i+1}" data-col="2" ${state.isOwner?'':'disabled'}>
            </div>
          </div>`).join('')}
        <div class="skill-cat">Contacts</div>
        ${d.contacts.map((row,i) => `
          <div class="field-row">
            ${fieldHtml('contacts',i+1,1,'Nome / info', row[0], true)}
            <div class="field" style="max-width:70px">
              <label>Score</label>
              <input type="number" value="${row[1] ?? ''}" data-block="contacts" data-row="${i+1}" data-col="2" ${state.isOwner?'':'disabled'}>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div class="acc-item">
      <div class="acc-head" onclick="toggleAcc(this)"><span>Skills</span><span class="chev">▶</span></div>
      <div class="acc-body">
        <div class="skill-header-row"><span></span><span>Skill</span><span>Base</span><span>Bonus</span><span>Tot.</span></div>
        ${d.skills.map((row,i) => {
          const [key,name,stat,base,checked,bonus,total,param] = row;
          const displayName = param ? `${name} (${param})` : name;
          return `
          <div class="skill-row">
            <input type="checkbox" data-block="skills" data-row="${i+1}" data-col="5" ${isChecked(checked)?'checked':''} ${state.isOwner?'':'disabled'}>
            <span class="skill-name">${displayName} <small>${stat?('('+stat+')'):''}</small></span>
            <input class="num" disabled value="${base ?? ''}">
            <input class="num" value="${bonus ?? ''}" data-block="skills" data-row="${i+1}" data-col="6" ${state.isOwner?'':'disabled'}>
            <input class="num" disabled value="${total ?? ''}">
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="acc-item">
      <div class="acc-head" onclick="toggleAcc(this)"><span>Weapons</span><span class="chev">▶</span></div>
      <div class="acc-body">
        <table class="weapon-table">
          <tr><th>Weapon</th><th>Skill%</th><th>Range</th><th>Dmg</th><th>AP</th><th>Leth%</th><th>Kill R.</th><th>Ammo</th></tr>
          ${d.weapons.map((row,i) => `
            <tr>
              ${row.slice(0,7).map((v,ci) => `<td><input value="${v ?? ''}" data-block="weapons" data-row="${i+1}" data-col="${ci+1}" ${state.creationMode && state.isOwner ? '' : 'disabled'}></td>`).join('')}
              <td><input type="number" value="${row[7] ?? ''}" data-block="weapons" data-row="${i+1}" data-col="8" ${state.isOwner?'':'disabled'}></td>
            </tr>`).join('')}
        </table>
      </div>
    </div>

    <div class="acc-item">
      <div class="acc-head" onclick="toggleAcc(this)"><span>Armor and Gears</span><span class="chev">▶</span></div>
      <div class="acc-body">
        <div class="gear-list" id="gearList">
          ${d.gear.map((row,i) => (row[0] ?? '').toString().trim() !== '' ? `
            <div class="gear-item">
              <input value="${row[0]}" data-block="gear" data-row="${i+1}" data-col="1" ${state.isOwner?'':'disabled'}>
              ${state.isOwner ? `<button onclick="clearGearRow(this,${i+1})">✕</button>` : ''}
            </div>` : '').join('')}
        </div>
        ${state.isOwner ? '<button class="add-gear" onclick="addGearRow()">+ Aggiungi oggetto</button>' : ''}
      </div>
    </div>
  `;

  // hook change tracking su tutti gli input generati
  acc.querySelectorAll('input[data-block]').forEach(inp => {
    const evt = inp.type === 'checkbox' ? 'change' : 'input';
    inp.addEventListener(evt, () => trackChange(inp));
  });
}

function trackChange(inp) {
  const block = inp.dataset.block;
  const row = parseInt(inp.dataset.row, 10);
  const col = parseInt(inp.dataset.col, 10);
  const value = inp.type === 'checkbox' ? inp.checked : inp.value;

  const existing = state.changes.find(c => c.block === block && c.row === row && c.col === col);
  if (existing) existing.value = value;
  else state.changes.push({ block, row, col, value });

  updateSaveStatus(`${state.changes.length} modifica/e non salvata/e`);
}

function addGearRow() {
  const firstEmpty = state.data.gear.findIndex(r => !(r[0] ?? '').toString().trim());
  if (firstEmpty === -1) { alert('Inventario pieno, aumenta le righe nel foglio.'); return; }
  const list = document.getElementById('gearList');
  const div = document.createElement('div');
  div.className = 'gear-item';
  div.innerHTML = `<input placeholder="Nuovo oggetto..." data-block="gear" data-row="${firstEmpty+1}" data-col="1">
    <button onclick="clearGearRow(this, ${firstEmpty+1})">✕</button>`;
  list.appendChild(div);
  div.querySelector('input').addEventListener('input', e => trackChange(e.target));
}

function clearGearRow(btn, row) {
  const input = btn.previousElementSibling;
  input.value = '';
  trackChange(input);
  btn.parentElement.remove();
}

// ============ CREATION MODE ============
document.getElementById('creationMode').addEventListener('change', function () {
  state.creationMode = this.checked;
  document.getElementById('modeBadge').textContent = state.creationMode ? 'ACCESSO COMPLETO' : 'SOLO CONSULTAZIONE';
  document.getElementById('modeBadge').className = 'mode-badge ' + (state.creationMode ? 'creation' : 'game');
  renderAccordion(); // ri-renderizza per sbloccare/bloccare i campi
});

// ============ SAVE ============
function updateSaveStatus(msg) {
  document.getElementById('saveStatus').textContent = msg;
}

document.getElementById('saveBtn').addEventListener('click', () => {
  if (state.changes.length === 0) { updateSaveStatus('Niente da salvare'); return; }
  if (!state.isOwner) { updateSaveStatus('Sola lettura: non puoi salvare'); return; }

  updateSaveStatus('Salvataggio in corso...');
  apiPost({
    action: 'save',
    character_tab: state.viewingCharacter,
    nickname: state.nickname,
    mode: state.creationMode ? 'creation' : 'game',
    changes: state.changes
  }).then(res => {
    if (!res.ok) { updateSaveStatus('Errore: ' + res.error); return; }
    state.changes = [];
    updateSaveStatus('Salvato ✓');
    loadCharacter(state.viewingCharacter); // ricarica per riflettere formule (base/totale)
  }).catch(() => updateSaveStatus('Errore di connessione'));
});

// ============ BOOT ============
tryAutoLogin();