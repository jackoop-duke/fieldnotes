// Pure rendering helpers. The host owns events, state persistence and CSS installation.
export const LIBRARY_CSS = `
.library nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0; }
.library nav button { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 8px 12px; cursor: pointer; }
.library nav button[aria-pressed="true"] { color: var(--ok); border-color: var(--ok); }
.library .panel { margin-top: 16px; }
.library ul.lib-tree { list-style: none; margin: 0; padding: 0; }
.library .lib-tree .lib-tree { margin-left: 16px; padding-left: 12px; border-left: 1px solid var(--line); }
.library .lib-row { grid-template-columns: minmax(0, 1fr); gap: 8px; }
.library .lib-controls, .library .lib-tags { display: flex; flex-wrap: wrap; gap: 12px; }
.library .lib-controls .check { border: 0; font-size: 15px; }
.library .lib-copy { white-space: pre-line; overflow-wrap: anywhere; }
.library .lib-progress { color: var(--muted); margin: 8px 0; }
.library .bar { margin-bottom: 12px; }
.library .lib-row.ach { grid-template-columns: 44px minmax(0, 1fr); align-items: start; column-gap: 12px; }
.library .lib-row.ach > .ach-body { display: grid; gap: 6px; min-width: 0; }
.library .lib-row.ach h3, .library .lib-row.ach .lede { margin: 0; }
.library .ach-icon { width: 44px; height: auto; max-height: 52px; object-fit: contain; }
.library .pr-head { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
.library .pr-head h2 { margin: 0; }
.library .pr-badge { height: 72px; width: auto; flex: none; }
.library .lib-search { width: 100%; max-width: 420px; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); padding: 9px 12px; margin: 4px 0 8px; }
.library .lib-count { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
.library .panel.pr-claimed { opacity: .7; }
.library .panel.pr-next { border-color: var(--ok); box-shadow: inset 3px 0 0 var(--ok); }
.library .pr-tag { font-size: 12.5px; font-weight: 700; padding: 2px 9px; border-radius: 4px; background: var(--surface-2); color: var(--muted); }
.library .pr-next .pr-tag { background: var(--ok-bg); color: var(--ok); }
`.trim();

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
const localized = (value, lang) => value?.[lang] || value?.[lang === 'zh' ? 'en' : 'zh'] || '';
const labels = {
  en: { library: 'Library', story: 'Storyline', collector: 'Collector', achievements: 'Achievements',
    prestige: 'Prestige', done: 'Completed', found: 'Found', handed: 'Handed in',
    acquired: 'Acquired', optional: 'Optional', common: 'Common', rare: 'Rare',
    legendary: 'Legendary', seasonal: 'Seasonal', percent: 'Players completed',
    search: 'Search by name (English or Chinese)', matches: '{0} of {1} shown', noMatch: 'Nothing matches.',
    prClaimed: 'Claimed', prNext: 'Next goal', prCurrent: 'Your prestige: {0} (change it under My tasks → profile)', prUnset: 'Set your current prestige under My tasks → profile to mark claimed levels.',
    empty: 'No entries available.', noPrestige: 'This game mode has no prestige levels in the data.', intro: 'Track your progress manually.', level: 'Level', about: 'About & backup' },
  zh: { library: '資料庫', story: '主線章節', collector: '收藏家', achievements: '成就',
    prestige: '聲望', done: '已完成', found: '已找到', handed: '已交付',
    acquired: '已取得', optional: '選用', common: '普通', rare: '稀有',
    legendary: '傳奇', seasonal: '賽季', percent: '玩家完成率',
    search: '搜尋名稱（中英文都可以）', matches: '顯示 {0} / {1} 項', noMatch: '沒有符合的項目。',
    prClaimed: '已取得', prNext: '下一個目標', prCurrent: '你目前的聲望：{0}（在「我的任務 → 個人設定」修改）', prUnset: '在「我的任務 → 個人設定」填入目前的聲望等級，就會標出已取得的等級。',
    empty: '目前沒有資料。', noPrestige: '這個遊戲模式的資料裡沒有聲望等級。', intro: '手動記錄你的進度。', level: '等級', about: '關於與備份' },
};
const checked = (record, id) => record?.[id] === true;
const fill = (s, ...v) => s.replace(/\{(\d)\}/g, (_, i) => v[i]);
// Name search for long lists (Jack 2026-10-07); matches both languages so either can be typed.
const searchBox = (query, text) => '<input type="search" id="lib-q" class="lib-search" value="' + escapeHTML(query) +
  '" placeholder="' + escapeHTML(text.search) + '" aria-label="' + escapeHTML(text.search) + '">';
const matches = (query, ...values) => !query || values.some(v => String(v?.en || '').toLowerCase().includes(query) || String(v?.zh || '').toLowerCase().includes(query));
const countLine = (shown, total, text) => '<p class="lib-count">' + escapeHTML(shown ? fill(text.matches, shown, total) : text.noMatch) + '</p>';
const checkbox = (kind, id, done, content) => '<label class="check' + (done ? ' isdone' : '') +
  '"><input type="checkbox" data-lib-kind="' + escapeHTML(kind) + '" data-lib-id="' +
  escapeHTML(id) + '"' + (done ? ' checked' : '') + '><span class="txt lib-copy">' + content + '</span></label>';
const flag = text => '<span class="flag bring">' + escapeHTML(text) + '</span>';
function progress(label, done, total) {
  const width = total ? done / total * 100 : 0;
  return '<p class="lib-progress">' + escapeHTML(label) + ': ' + escapeHTML(done) + ' / ' +
    escapeHTML(total) + '</p><div class="bar" aria-hidden="true"><i style="width:' +
    escapeHTML(width) + '%"></i></div>';
}
function renderStory(chapters, state, lang, text) {
  return chapters.map(chapter => {
    const objectives = chapter.objectives || [];
    const children = new Map();
    for (const objective of objectives) {
      const siblings = children.get(objective.parent) || [];
      siblings.push(objective);
      children.set(objective.parent, siblings);
    }
    const visited = new Set();
    function tree(nodes) {
      const content = nodes.filter(o => !visited.has(o.id)).map(o => {
        visited.add(o.id);
        return '<li>' + checkbox('story', o.id, checked(state.story, o.id),
          escapeHTML(localized(o.text, lang)) + (o.optional ? ' ' + flag(text.optional) : '')) +
          tree((children.get(o.id) || []).filter(child => !visited.has(child.id))) + '</li>';
      }).join('');
      return content ? '<ul class="lib-tree">' + content + '</ul>' : '';
    }
    const roots = tree(children.get(null) || []);
    // Keep malformed/orphan records visible without risking recursive cycles.
    const remaining = tree(objectives.filter(o => !visited.has(o.id)));
    return '<article class="panel" data-lib-chapter="' + escapeHTML(chapter.id) + '"><h2>' +
      escapeHTML(localized(chapter.title, lang)) + '</h2>' +
      progress(text.done, objectives.filter(o => checked(state.story, o.id)).length, objectives.length) +
      roots + remaining + '</article>';
  }).join('');
}
function renderCollector(data, state, lang, text, query = '') {
  const task = data.tasks?.find(t => t.key === 'collector');
  const ids = [...new Set((task?.objectives || []).filter(o => o.type === 'giveItem').flatMap(o => o.items || []))];
  const shown = ids.filter(id => matches(query, data.items?.[id]?.name));
  const count = kind => ids.filter(id => state.collector?.[id]?.[kind] === true).length;
  return '<section class="panel"><h2>' + escapeHTML(text.collector) + '</h2>' +
    progress(text.found, count('found'), ids.length) + progress(text.handed, count('handed'), ids.length) +
    searchBox(query, text) + (query ? countLine(shown.length, ids.length, text) : '') +
    '<div class="rows">' + shown.map(id => {
      const name = localized(data.items?.[id]?.name, lang) || id;
      return '<article class="row lib-row" data-lib-item="' + escapeHTML(id) + '"><b class="lib-copy">' +
        escapeHTML(name) + '</b><div class="lib-controls">' +
        checkbox('found', id, state.collector?.[id]?.found === true, escapeHTML(text.found)) +
        checkbox('handed', id, state.collector?.[id]?.handed === true, escapeHTML(text.handed)) +
        '</div></article>';
    }).join('') + '</div>' + (!ids.length ? '<p class="lede">' + escapeHTML(text.empty) + '</p>' : '') + '</section>';
}
function renderAchievements(achievements, state, lang, text, query = '') {
  const shown = achievements.filter(a => matches(query, a.name, a.description));
  return '<section class="panel"><h2>' + escapeHTML(text.achievements) + '</h2>' +
    progress(text.acquired, achievements.filter(a => checked(state.ach, a.id)).length, achievements.length) +
    searchBox(query, text) + (query ? countLine(shown.length, achievements.length, text) : '') +
    '<div class="rows">' + shown.map(a => {
      const side = { pmc: 'PMC', scav: 'Scav', all: 'PMC/Scav' }[a.side] || a.side;
      const img = a.icon ? '<img class="ach-icon" src="' + escapeHTML(a.icon) + '" alt="" width="44" height="50" loading="lazy" decoding="async">' : '<span></span>';
      return '<article class="row lib-row ach">' + img + '<div class="ach-body"><h3 class="lib-copy">' + escapeHTML(localized(a.name, lang)) +
        '</h3><p class="lede lib-copy">' + escapeHTML(localized(a.description, lang)) +
        '</p><div class="lib-tags">' + flag(text[a.rarity] || a.rarity) + flag(side) +
        '<span>' + escapeHTML(text.percent) + ': ' + escapeHTML(a.percent ?? 'N') +
        (a.percent == null ? '' : '%') + '</span></div>' +
        checkbox('ach', a.id, checked(state.ach, a.id), escapeHTML(text.acquired)) + '</div></article>';
    }).join('') + '</div></section>';
}
// current: the player's prestige level from the profile (null = not set); claimed levels dim, the next one is marked.
function renderPrestige(levels, lang, text, current = null) {
  if (!levels.length) return '<p class="lede">' + escapeHTML(text.noPrestige) + '</p>';
  const set = Number.isInteger(current);
  return '<p class="lede">' + escapeHTML(set ? fill(text.prCurrent, current) : text.prUnset) + '</p>' + levels.map(p => {
    const state = !set ? '' : p.level <= current ? 'claimed' : p.level === current + 1 ? 'next' : '';
    return '<article class="panel' + (state ? ' pr-' + state : '') + '"><div class="pr-head">' +
    (p.icon ? '<img class="pr-badge" src="' + escapeHTML(p.icon) + '" alt="" height="72" loading="lazy" decoding="async">' : '') +
    '<h2>' + escapeHTML(text.prestige) + ' — ' + escapeHTML(text.level) + ' ' + escapeHTML(p.level) + '</h2>' +
    (state ? '<span class="pr-tag">' + escapeHTML(state === 'claimed' ? text.prClaimed : text.prNext) + '</span>' : '') + '</div><ul>' +
    (p.conditions || []).map(c => '<li class="lib-copy">' + escapeHTML(localized(c.text, lang)) + '</li>').join('') +
    '</ul></article>';
  }).join('');
}
// shown: sections to offer (the planner moved the storyline out of the library on 2026-10-04).
// extra: {section: html} rendered by the caller (the planner's About & backup page).
// opts: { query (lower-case name search for collector/achievements), prestige (player's level or null) }
export function renderLibrary(lib, plannerData, libState, lang = 'zh', section = 'story', shown = ['story', 'collector', 'achievements', 'prestige'], extra = {}, opts = {}) {
  const query = String(opts.query || '').trim().toLowerCase();
  const language = lang === 'en' ? 'en' : 'zh', text = labels[language];
  const sections = shown;
  const active = sections.includes(section) ? section : sections[0];
  const state = libState || {}, data = lib || {};
  const content = extra[active] ?? {
    story: () => renderStory(data.storyline || [], state, language, text),
    collector: () => renderCollector(plannerData || {}, state, language, text, query),
    achievements: () => renderAchievements(data.achievements || [], state, language, text, query),
    // prestige differs per game mode; data.prestige (PvP) is the fallback for older library files
    prestige: () => renderPrestige((data.prestigeByMode ? data.prestigeByMode[plannerData?.mode] : data.prestige) || [], language, text, opts.prestige ?? null),
  }[active]();
  return '<div class="library"><h1>' + escapeHTML(text.library) + '</h1><p class="lede">' +
    escapeHTML(text.intro) + '</p><nav aria-label="' + escapeHTML(text.library) + '">' +
    sections.map(key => '<button type="button" data-lib-section="' + escapeHTML(key) +
      '" aria-pressed="' + (key === active ? 'true' : 'false') + '">' + escapeHTML(text[key]) + '</button>').join('') +
    '</nav><h2 class="section-label">' + escapeHTML(text[active]) + '</h2>' +
    (content || '<p class="lede">' + escapeHTML(text.empty) + '</p>') + '</div>';
}
