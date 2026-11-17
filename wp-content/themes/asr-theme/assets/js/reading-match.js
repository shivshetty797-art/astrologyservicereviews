/* Reading Match: ШІ-підбір формату читання. Інтерфейс «бланк + аркуш збігу».
 * Відповідь стримиться з Cloudflare Worker (/api/reading-match/); при обриві потоку повторюємо автоматично. */
(function () {
  'use strict';
  var root = document.getElementById('rm-app');
  var cfgEl = document.getElementById('rm-config');
  if (!root || !cfgEl) return;
  var cfg = JSON.parse(cfgEl.textContent);

  var ENDPOINT = '/api/reading-match/';
  if (location.port) {
    var q = /[?&]rmport=(\d{4,5})/.exec(location.search);
    ENDPOINT = location.protocol + '//' + location.hostname + ':' + (q ? q[1] : '8834') + ENDPOINT;
  }

  var FORMATS = [
    { key: 'tarot', name: 'Tarot spread', hint: 'A few cards as prompts for a decision or a feeling.' },
    { key: 'chart', name: 'Birth chart reading', hint: 'Your chart as a map of long-running patterns.' },
    { key: 'pair', name: 'Compatibility (synastry) reading', hint: 'Two charts compared side by side.' },
    { key: 'timing', name: 'Timing and transits reading', hint: 'What the sky is doing around you right now.' },
    { key: 'live', name: 'Live conversation with a reader', hint: 'A back-and-forth session you steer yourself.' }
  ];
  var TOPICS = [['love', 'Love'], ['work', 'Work'], ['money', 'Money'], ['decision', 'A decision'], ['self', 'Myself'], ['family', 'Family & friends']];
  var FORMAT_OPTS = [['any', 'No preference'], ['chat', 'Text chat'], ['call', 'Call'], ['report', 'Written report']];
  var BUDGET_OPTS = [['low', 'Under $20'], ['mid', '$20–60'], ['high', '$60+'], ['unsure', 'Not sure']];
  var BIRTH_OPTS = [['exact', 'Exact time'], ['approx', 'Roughly'], ['none', 'No details']];

  var state = { voice: cfg.voices[0].slug, topics: [], x: 50, y: 50, format: 'any', budget: 'unsure', birth: 'approx', note: '', busy: false, touchedPad: false };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function say(msg) { live.textContent = ''; setTimeout(function () { live.textContent = msg; }, 30); }

  var live = el('div', { class: 'rm-sr', 'aria-live': 'polite', role: 'status' });

  /* ---------- Бланк (ліворуч) ---------- */
  var slip = el('form', { class: 'rm-slip', novalidate: 'novalidate', 'aria-label': 'Your brief' });
  slip.addEventListener('submit', function (e) { e.preventDefault(); run(0); });

  function fieldset(legend, num, body, hintText) {
    var fs = el('fieldset', { class: 'rm-field' });
    fs.appendChild(el('legend', {}, [el('span', { class: 'rm-num', text: num }), document.createTextNode(legend)]));
    if (hintText) fs.appendChild(el('p', { class: 'rm-hint', text: hintText }));
    fs.appendChild(body);
    return fs;
  }

  // 1. Голос
  var voiceWrap = el('div', { class: 'rm-voices', role: 'radiogroup', 'aria-label': 'AI desk voice' });
  cfg.voices.forEach(function (v, i) {
    var b = el('button', {
      type: 'button', class: 'rm-voice', role: 'radio', 'aria-checked': i === 0 ? 'true' : 'false', 'data-slug': v.slug, 'data-nebula-preserve': '1',
      onclick: function () { pickVoice(v.slug); }
    }, [
      el('span', { class: 'rm-stamp', 'aria-hidden': 'true', text: v.initial }),
      el('span', { class: 'rm-voice-name', text: v.name }),
      el('span', { class: 'rm-voice-desk', text: v.desk }),
      el('span', { class: 'rm-voice-tag', text: 'AI voice' })
    ]);
    voiceWrap.appendChild(b);
  });
  function pickVoice(slug) {
    state.voice = slug;
    [].forEach.call(voiceWrap.children, function (b) { b.setAttribute('aria-checked', b.getAttribute('data-slug') === slug ? 'true' : 'false'); });
    var v = cfg.voices.filter(function (x) { return x.slug === slug; })[0];
    voiceNote.textContent = v.style;
  }
  var voiceNote = el('p', { class: 'rm-voice-note', text: cfg.voices[0].style });
  slip.appendChild(fieldset('Who should read your brief?', '1', el('div', {}, [voiceWrap, voiceNote])));

  // 2. Теми
  var topicWrap = el('div', { class: 'rm-chips' });
  TOPICS.forEach(function (t) {
    topicWrap.appendChild(el('button', {
      type: 'button', class: 'rm-chip', 'aria-pressed': 'false', 'data-key': t[0], 'data-nebula-preserve': '1', text: t[1],
      onclick: function (e) {
        var i = state.topics.indexOf(t[0]);
        if (i >= 0) state.topics.splice(i, 1);
        else if (state.topics.length < 3) state.topics.push(t[0]);
        else { topicMsg.textContent = 'Pick up to three.'; return; }
        topicMsg.textContent = '';
        [].forEach.call(topicWrap.children, function (b) { b.setAttribute('aria-pressed', state.topics.indexOf(b.getAttribute('data-key')) >= 0 ? 'true' : 'false'); });
      }
    }));
  });
  var topicMsg = el('p', { class: 'rm-msg', role: 'alert' });
  slip.appendChild(fieldset('What is this about?', '2', el('div', {}, [topicWrap, topicMsg]), 'Choose one to three.'));

  // 3. Планшет-«компас»
  var dot = el('div', { class: 'rm-dot', 'aria-hidden': 'true' });
  var pad = el('div', {
    class: 'rm-pad', tabindex: '0', role: 'group', 'aria-label': 'Focus pad. Use arrow keys to move the marker.'
  }, [
    el('span', { class: 'rm-ax rm-ax-l', text: 'About me', 'aria-hidden': 'true' }),
    el('span', { class: 'rm-ax rm-ax-r', text: 'About someone else', 'aria-hidden': 'true' }),
    el('span', { class: 'rm-ax rm-ax-t', text: 'Next few weeks', 'aria-hidden': 'true' }),
    el('span', { class: 'rm-ax rm-ax-b', text: 'Bigger pattern', 'aria-hidden': 'true' }),
    el('span', { class: 'rm-cross rm-cross-h', 'aria-hidden': 'true' }),
    el('span', { class: 'rm-cross rm-cross-v', 'aria-hidden': 'true' }),
    dot
  ]);
  var padRead = el('p', { class: 'rm-pad-read', role: 'status' });
  function padLabel() {
    var who = state.x < 34 ? 'mostly about you' : (state.x > 66 ? 'mostly about someone else' : 'about you and someone else');
    var when = state.y < 34 ? 'the next few weeks' : (state.y > 66 ? 'a bigger life pattern' : 'near and long term');
    return who + ', looking at ' + when;
  }
  function paintPad() {
    dot.style.left = state.x + '%';
    dot.style.top = state.y + '%';
    padRead.textContent = padLabel();
  }
  function setFromPointer(e) {
    var r = pad.getBoundingClientRect();
    state.x = Math.max(0, Math.min(100, Math.round(((e.clientX - r.left) / r.width) * 100)));
    state.y = Math.max(0, Math.min(100, Math.round(((e.clientY - r.top) / r.height) * 100)));
    state.touchedPad = true;
    paintPad();
  }
  var dragging = false;
  pad.addEventListener('pointerdown', function (e) { dragging = true; try { pad.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } setFromPointer(e); pad.focus(); });
  pad.addEventListener('pointermove', function (e) { if (dragging) setFromPointer(e); });
  pad.addEventListener('pointerup', function () { dragging = false; });
  pad.addEventListener('pointercancel', function () { dragging = false; });
  pad.addEventListener('keydown', function (e) {
    var d = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[e.key];
    if (!d) return;
    e.preventDefault();
    state.x = Math.max(0, Math.min(100, state.x + d[0]));
    state.y = Math.max(0, Math.min(100, state.y + d[1]));
    state.touchedPad = true;
    paintPad();
  });
  slip.appendChild(fieldset('Where does your question sit?', '3', el('div', {}, [pad, padRead]), 'Drag the marker, or use the arrow keys.'));

  // 4-6. Радіогрупи
  function radios(opts, key) {
    var w = el('div', { class: 'rm-chips', role: 'radiogroup' });
    opts.forEach(function (o) {
      w.appendChild(el('button', {
        type: 'button', class: 'rm-chip', role: 'radio', 'aria-checked': state[key] === o[0] ? 'true' : 'false', 'data-key': o[0], 'data-nebula-preserve': '1', text: o[1],
        onclick: function () {
          state[key] = o[0];
          [].forEach.call(w.children, function (b) { b.setAttribute('aria-checked', b.getAttribute('data-key') === o[0] ? 'true' : 'false'); });
        }
      }));
    });
    return w;
  }
  slip.appendChild(fieldset('How would you like to be read?', '4', radios(FORMAT_OPTS, 'format')));
  slip.appendChild(fieldset('Budget for one reading', '5', radios(BUDGET_OPTS, 'budget')));
  slip.appendChild(fieldset('Do you know your birth time?', '6', radios(BIRTH_OPTS, 'birth'), 'Only your own answer is used. Never enter dates or personal details below.'));

  // 7. Нотатка
  var note = el('textarea', { class: 'rm-note', id: 'rm-note', rows: '3', maxlength: '240', placeholder: 'Optional: one sentence about what you want to understand' });
  note.addEventListener('input', function () { state.note = note.value; count.textContent = note.value.length + ' / 240'; });
  var count = el('span', { class: 'rm-count', text: '0 / 240' });
  slip.appendChild(fieldset('In your own words (optional)', '7', el('div', {}, [note, count])));

  var go = el('button', { type: 'submit', class: 'rm-go', 'data-nebula-preserve': '1' }, [document.createTextNode('Match my brief '), el('span', { 'aria-hidden': 'true', text: '→' })]);
  slip.appendChild(go);
  slip.appendChild(el('p', { class: 'rm-fine', text: 'AI-written suggestion for entertainment and self-reflection. It does not recommend any company, and it is not a prediction or professional advice.' }));

  /* ---------- Аркуш збігу (праворуч) ---------- */
  var sheet = el('section', { class: 'rm-sheet', 'aria-labelledby': 'rm-sheet-title' });
  var sheetTitle = el('h2', { id: 'rm-sheet-title', tabindex: '-1', text: 'Your match sheet' });
  var sheetSub = el('p', { class: 'rm-sheet-sub', text: 'Fill in the brief and this sheet scores five reading formats for you.' });
  var rows = el('ol', { class: 'rm-rows' });
  var textBox = el('div', { class: 'rm-text', 'aria-live': 'off' });
  var links = el('div', { class: 'rm-links' });
  var foot = el('div', { class: 'rm-foot' });
  sheet.appendChild(el('div', { class: 'rm-sheet-head' }, [el('span', { class: 'rm-ai-badge', text: 'AI' }), sheetTitle]));
  sheet.appendChild(sheetSub); sheet.appendChild(rows); sheet.appendChild(textBox); sheet.appendChild(links); sheet.appendChild(foot);

  var rowEls = {};
  function buildRows(scores) {
    rows.innerHTML = '';
    var list = FORMATS.map(function (f, i) { return { f: f, s: scores ? scores[f.key] : null, i: i }; });
    if (scores) list.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
    list.forEach(function (it, rank) {
      var pips = el('span', { class: 'rm-pips', 'aria-hidden': 'true' });
      for (var p = 0; p < 5; p++) pips.appendChild(el('i', { class: scores && p < it.s ? 'on' : '' }));
      var li = el('li', { class: 'rm-row' + (scores && rank === 0 && it.s > 0 ? ' top' : '') + (scores ? '' : ' idle') }, [
        el('span', { class: 'rm-rank', text: scores ? String(rank + 1) : '·' }),
        el('span', { class: 'rm-row-main' }, [el('strong', { text: it.f.name }), el('small', { text: it.f.hint })]),
        pips,
        el('span', { class: 'rm-sr', text: scores ? it.s + ' out of 5' : '' })
      ]);
      rows.appendChild(li);
      rowEls[it.f.key] = li;
    });
  }
  buildRows(null);

  /* ---------- Розбір відповіді ---------- */
  var SC = /SCORES:\s*tarot\s*=\s*(\d)\s+chart\s*=\s*(\d)\s+pair\s*=\s*(\d)\s+timing\s*=\s*(\d)\s+live\s*=\s*(\d)/i;
  function parseScores(t) {
    var m = SC.exec(t);
    if (!m) return null;
    return { tarot: +m[1], chart: +m[2], pair: +m[3], timing: +m[4], live: +m[5] };
  }
  function inline(parent, text) {
    text.split(/(\*\*[^*]+\*\*)/).forEach(function (part) {
      if (!part) return;
      if (part.slice(0, 2) === '**' && part.slice(-2) === '**') parent.appendChild(el('strong', { text: part.slice(2, -2) }));
      else parent.appendChild(document.createTextNode(part));
    });
  }
  function renderText(full) {
    textBox.innerHTML = '';
    var body = full.replace(SC, '').replace(/^\s*SCORES:.*$/im, '').trim();
    var ul = null;
    body.split(/\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) { ul = null; return; }
      if (/^[-*•]\s+/.test(line)) {
        if (!ul) { ul = el('ul', { class: 'rm-list' }); textBox.appendChild(ul); }
        var li = el('li'); inline(li, line.replace(/^[-*•]\s+/, '')); ul.appendChild(li); return;
      }
      ul = null;
      if (/^\*\*[^*]+\*\*:?$/.test(line)) { textBox.appendChild(el('h3', { text: line.replace(/\*\*/g, '').replace(/:$/, '') })); return; }
      var p = el('p'); inline(p, line); textBox.appendChild(p);
    });
  }
  function readNext(scores) {
    links.innerHTML = '';
    var order = FORMATS.map(function (f) { return f.key; }).sort(function (a, b) { return scores[b] - scores[a]; }).slice(0, 2);
    var box = el('div', { class: 'rm-next' }, [el('h3', { text: 'Read next on this site' })]);
    var ul = el('ul');
    order.forEach(function (k) {
      (cfg.links[k] || []).forEach(function (l) {
        if (l.when === 'birth-unsure' && state.birth === 'exact') return;
        ul.appendChild(el('li', {}, [el('a', { href: l.url, text: l.label })]));
      });
    });
    box.appendChild(ul);
    links.appendChild(box);
  }

  /* ---------- Запит із автоповтором ---------- */
  var current = null;
  function payload() {
    return { voice: state.voice, topics: state.topics, x: state.x, y: state.y, format: state.format, budget: state.budget, birth: state.birth, note: state.note.trim() };
  }
  function run(attempt) {
    if (state.busy && attempt === 0) return;
    if (!state.topics.length) { topicMsg.textContent = 'Pick at least one topic first.'; topicWrap.firstChild.focus(); return; }
    state.busy = true; go.disabled = true;
    var voice = cfg.voices.filter(function (v) { return v.slug === state.voice; })[0];
    sheetTitle.textContent = 'Match sheet from ' + voice.name + ' (AI)';
    sheetSub.textContent = attempt ? 'The first attempt was cut short, trying again (' + attempt + ' of 2)...' : voice.name + ' is reading your brief...';
    textBox.innerHTML = ''; links.innerHTML = ''; foot.innerHTML = '';
    sheet.classList.add('is-busy');
    if (!attempt) buildRows(null);
    if (window.matchMedia('(max-width: 899px)').matches) sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var full = '', cut = false, scored = false;
    var token = {}; current = token;

    function retryOrFail(msg) {
      if (current !== token) return;
      if (attempt < 2) { return setTimeout(function () { if (current === token) run(attempt + 1); }, 700 * (attempt + 1)); }
      sheet.classList.remove('is-busy');
      sheetSub.textContent = msg;
      if (full) renderText(full);
      foot.innerHTML = '';
      foot.appendChild(el('button', { type: 'button', class: 'rm-btn', 'data-nebula-preserve': '1', text: 'Try again', onclick: function () { run(0); } }));
      state.busy = false; go.disabled = false;
    }
    function fatal(msg) { // помилки валідації/ліміту повтором не лікуються
      sheet.classList.remove('is-busy'); sheetSub.textContent = msg;
      state.busy = false; go.disabled = false;
    }
    function finish() {
      if (current !== token) return;
      var sc = parseScores(full);
      if (!full.trim() || cut || !sc) return retryOrFail('The match came back incomplete. Please try again.');
      sheet.classList.remove('is-busy');
      sheetSub.textContent = 'Scores run from 0 to 5. They describe fit with your brief, not quality of any service.';
      buildRows(sc); renderText(full); readNext(sc);
      foot.innerHTML = '';
      foot.appendChild(el('p', { class: 'rm-disclaimer', text: 'Written by an AI in the style of ' + voice.name + '. It is not a live session, a prediction or professional advice, and it does not rate or recommend any provider.' }));
      var act = el('div', { class: 'rm-actions' }, [
        el('button', { type: 'button', class: 'rm-btn', 'data-nebula-preserve': '1', text: 'Ask another desk', onclick: function () { slip.scrollIntoView({ behavior: 'smooth' }); } }),
        el('button', { type: 'button', class: 'rm-btn rm-btn-ghost', 'data-nebula-preserve': '1', text: 'Copy checklist', onclick: function (e) {
          var items = [].map.call(textBox.querySelectorAll('li'), function (l) { return '- ' + l.textContent; }).join('\n');
          var t = 'Questions to ask before booking:\n' + items;
          if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { e.target.textContent = 'Copied'; }, function () { });
        } })
      ]);
      foot.appendChild(act);
      foot.appendChild(el('div', { class: 'rm-live' }, [
        el('p', { text: 'Want to compare live services against that checklist?' }),
        el('a', { class: 'btn btn--outline', href: '/go/', rel: 'nofollow sponsored', text: 'See a live service’s current terms' })
      ]));
      state.busy = false; go.disabled = false;
      sheetTitle.focus(); say('Your match sheet is ready');
    }

    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) }).then(function (res) {
      if (!res.ok) {
        if (res.status === 503 || res.status >= 500) return retryOrFail('The match is unavailable right now. Please try again in a moment.');
        return res.json().then(function (j) { fatal((j && j.error) || 'Please check your answers and try again.'); }, function () { fatal('Please try again in a moment.'); });
      }
      var ct = res.headers.get('Content-Type') || '';
      if (!res.body || ct.indexOf('text/event-stream') < 0) return retryOrFail('The match is unavailable right now.');
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      (function pump() {
        reader.read().then(function (r) {
          if (current !== token) { try { reader.cancel(); } catch (e) { /* ok */ } return; }
          if (r.done) return finish();
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split('\n'); buf = lines.pop();
          lines.forEach(function (ln) {
            if (ln.indexOf('data:') !== 0) return;
            var d = ln.slice(5).trim();
            if (d === '[DONE]') return;
            try { var j = JSON.parse(d); if (typeof j.t === 'string') full += j.t; if (j.cut) cut = true; } catch (e) { /* неповний рядок */ }
          });
          if (!scored) { var sc = parseScores(full); if (sc) { scored = true; buildRows(sc); sheetSub.textContent = 'Scores are in. Writing the notes...'; } }
          if (scored) renderText(full);
          pump();
        }, function () { full ? finish() : retryOrFail('The connection dropped. Please try again.'); });
      })();
    }, function () { retryOrFail('Could not reach the match service. Please check your connection and try again.'); });
  }

  paintPad();
  var grid = el('div', { class: 'rm-grid' }, [slip, sheet]);
  root.appendChild(grid);
  root.appendChild(live);
})();
