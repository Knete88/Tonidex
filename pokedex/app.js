/* Mein Pokédex – sprachgesteuerter Pokédex für Kinder.
 * Läuft komplett im Browser: Spracherkennung + Sprachausgabe über die Web Speech API,
 * Daten aus data/pokedex-de.json (erzeugt aus der PokéAPI). */
'use strict';

const SPRITE_BIG = id => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
const CRY = id => `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${id}.ogg`;
const CRY_LEGACY = id => `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/legacy/${id}.ogg`;

const TYPE_COLORS = {
  1: '#9fa19f', 2: '#ff8000', 3: '#81b9ef', 4: '#9141cb', 5: '#915121', 6: '#afa981',
  7: '#91a119', 8: '#704170', 9: '#60a1b8', 10: '#e62829', 11: '#2980ef', 12: '#3fa129',
  13: '#fac000', 14: '#ef4179', 15: '#3dcef3', 16: '#5060e1', 17: '#624d4e', 18: '#ef70ef',
};
const GEN_RANGES = [[1, 151], [152, 251], [252, 386], [387, 493], [494, 649], [650, 721], [722, 809], [810, 905], [906, 1025]];

const $ = s => document.querySelector(s);
const state = {
  data: null, byId: new Map(), keys: [], last: null, flavorIdx: 0,
  settings: { voice: '', preset: 'natural', beeps: true, quizGen: '1', kidHeight: '110' },
  favs: [],
  learned: {},
};

/* ---------------------------------------------------------------- Speicher */
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* egal */ }
}

/* ---------------------------------------------------------------- Töne */
let audioCtx = null;
function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function beep(freqs, dur = 0.07, type = 'square', vol = 0.06) {
  if (!state.settings.beeps) return Promise.resolve();
  const ac = ctx();
  if (!ac) return Promise.resolve();
  let t = ac.currentTime + 0.01;
  for (const f of freqs) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + dur);
    t += dur;
  }
  return new Promise(r => setTimeout(r, (t - ac.currentTime) * 1000));
}
const sfx = {
  start: () => beep([880, 1320], 0.06),
  stop: () => beep([1320, 880], 0.06),
  dex: () => beep([1046, 1318, 1568, 2093], 0.05, 'square', 0.05),
  right: () => beep([523, 659, 784, 1046], 0.11, 'triangle', 0.15),
  wrong: () => beep([330, 262], 0.16, 'triangle', 0.12),
};

/* ---------------------------------------------------------------- Sprachausgabe */
const PRESETS = {
  natural: { pitch: 1.0, rate: 0.95, pause: 220 },
  lively: { pitch: 1.12, rate: 1.0, pause: 180 },
  slow: { pitch: 1.0, rate: 0.82, pause: 320 },
  robot: { pitch: 0.75, rate: 1.0, pause: 120 },
};
// Bewertet, wie natürlich eine Stimme vermutlich klingt (höher = besser)
function voiceQuality(v) {
  const n = v.name.toLowerCase();
  let q = 0;
  if (/premium|erweitert|enhanced|neural|natural|wavenet/.test(n)) q += 10;
  if (/google/.test(n)) q += 4;                    // Android: Google-Stimmen klingen ordentlich
  if (/anna|petra|helena|markus|yannick|martin|vicki|katja|conrad|amala|seraphina/.test(n)) q += 2;
  if (/eloquence|grandma|grandpa|oma|opa|rocko|shelley|flo|reed|sandy|eddy/.test(n)) q -= 8; // Spaß-/Roboterstimmen
  if (v.lang === 'de-DE' || v.lang === 'de_DE') q += 1;
  return q;
}
let voices = [];
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  voices = speechSynthesis.getVoices()
    .filter(v => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith('de'))
    .sort((a, b) => voiceQuality(b) - voiceQuality(a));
  const sel = $('#setVoice');
  sel.innerHTML = '';
  sel.append(new Option('Automatisch (beste Stimme)', ''));
  for (const v of voices) sel.append(new Option(`${voiceQuality(v) >= 10 ? '⭐ ' : ''}${v.name}`, v.voiceURI));
  sel.value = voices.some(v => v.voiceURI === state.settings.voice) ? state.settings.voice : '';
  const best = voices[0];
  const hint = $('#voiceHint');
  if (hint) hint.style.display = best && voiceQuality(best) >= 10 ? 'none' : '';
}
function pickVoice() {
  return voices.find(v => v.voiceURI === state.settings.voice)
    || voices[0] || null;
}
function speakable(text) {
  return text.replace(/♀/g, ' weiblich').replace(/♂/g, ' männlich').replace(/Pokémon/g, 'Pokemon');
}
let speakToken = 0;
function speak(text) {
  if (!('speechSynthesis' in window)) return Promise.resolve();
  speechSynthesis.cancel();
  const token = ++speakToken;
  // In kurze Sätze zerlegen: lange Texte brechen in manchen Browsern mittendrin ab.
  const parts = speakable(text).match(/[^.!?]+[.!?]*/g) || [text];
  const p = PRESETS[state.settings.preset] || PRESETS.natural;
  const voice = pickVoice();
  const lens = $('#lens');
  return new Promise(resolve => {
    let i = 0;
    const next = () => {
      if (token !== speakToken) return resolve();
      if (i >= parts.length) { lens.classList.remove('talking'); return resolve(); }
      const u = new SpeechSynthesisUtterance(parts[i++].trim());
      u.lang = 'de-DE'; u.pitch = p.pitch; u.rate = p.rate;
      if (voice) u.voice = voice;
      u.onstart = () => lens.classList.add('talking');
      u.onend = () => setTimeout(next, p.pause);   // kleine Atempause zwischen Sätzen
      u.onerror = next;
      speechSynthesis.speak(u);
    };
    next();
  });
}
function stopSpeaking() {
  speakToken++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  $('#lens').classList.remove('talking');
}

/* ---------------------------------------------------------------- Spracherkennung */
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_STANDALONE = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);

// Hinweis für Eltern unten im Bild (bleibt einige Sekunden stehen)
function parentHint(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(parentHint.timer);
  parentHint.timer = setTimeout(() => t.classList.remove('show'), 15000);
}

function micErrorHelp(code) {
  if (code === 'service-not-allowed' && IS_IOS) {
    return IS_STANDALONE
      ? 'Für Eltern: Das iPhone erlaubt die Spracherkennung hier nicht. 1) Einstellungen → Allgemein → Tastatur → „Diktierfunktion“ einschalten. 2) Falls es dann immer noch nicht geht: den Pokédex direkt in Safari öffnen statt über das App-Symbol.'
      : 'Für Eltern: Bitte Einstellungen → Allgemein → Tastatur → „Diktierfunktion“ einschalten (und ggf. Siri). Dann die Seite neu laden.';
  }
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return IS_IOS
      ? 'Für Eltern: Mikrofon ist blockiert. In Safari links in der Adressleiste auf „aA“ → Website-Einstellungen → Mikrofon → „Erlauben“. Außerdem: Einstellungen → Datenschutz → Spracherkennung → Safari erlauben. Dann Seite neu laden.'
      : 'Für Eltern: Mikrofon ist blockiert. Auf das Schloss-Symbol neben der Adresse tippen → Berechtigungen → Mikrofon erlauben. Dann Seite neu laden.';
  }
  if (code === 'audio-capture') return 'Für Eltern: Es wurde kein Mikrofon gefunden oder es wird gerade von einer anderen App benutzt.';
  if (code === 'network') return 'Für Eltern: Die Spracherkennung braucht eine Internetverbindung.';
  return `Für Eltern: Spracherkennung meldet „${code}“.`;
}

// Hört einmal zu. Ergebnis: Liste möglicher Sätze, [] = nichts gehört, null = abgebrochen/Fehler.
function listen(button) {
  return new Promise(resolve => {
    if (!Recognition) {
      parentHint('Für Eltern: Dieser Browser kann nicht zuhören. Bitte Safari (iPhone/iPad) oder Chrome (Android) verwenden.');
      speak('Dieses Gerät kann leider nicht zuhören.');
      return resolve(null);
    }
    // Nochmal tippen während des Zuhörens = aufhören
    if (button.classList.contains('listening') && rec) { try { rec.stop(); } catch { /* egal */ } return resolve(null); }

    // Ton-Ausgabe anhalten: Auf dem iPhone beendet laufender Ton das Zuhören sofort.
    if ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) stopSpeaking();
    if (audioCtx && audioCtx.state === 'running' && IS_IOS) { try { audioCtx.suspend(); } catch { /* egal */ } }
    if (rec) { try { rec.abort(); } catch { /* egal */ } }

    const log = [];
    let results = [];
    let failed = null;
    let done = false;
    let safety = null;
    let attempt = 0;
    let t0 = 0;

    const finish = () => {
      if (done) return;
      // Sofort wieder beendet, ohne etwas zu hören? Dann einmal neu versuchen.
      if (!results.length && !failed && attempt < 2 && Date.now() - t0 < 1500) {
        log.push('neuer Versuch');
        return setTimeout(startOnce, 250);
      }
      done = true;
      clearTimeout(safety);
      button.classList.remove('listening');
      $('#lens').classList.remove('listening');
      if (audioCtx && IS_IOS) { try { audioCtx.resume(); } catch { /* egal */ } }
      if (failed && failed !== 'no-speech') {
        parentHint(micErrorHelp(failed) + ` [${log.join(' › ')}]`);
        if (failed === 'not-allowed' || failed === 'service-not-allowed') speak('Ich darf das Mikrofon nicht benutzen. Bitte frag einen Erwachsenen.');
        else if (failed !== 'aborted') speak('Hoppla, das Zuhören hat nicht geklappt.');
        return resolve(null);
      }
      if (!results.length && Date.now() - t0 < 2500) {
        parentHint('Für Eltern: Das Zuhören wurde sofort wieder beendet. Bitte prüfen: Einstellungen → Allgemein → Tastatur → „Diktierfunktion“ an? Läuft gerade Musik oder ein Video? '
          + `[${log.join(' › ')}]`);
      }
      sfx.stop();
      resolve(results);
    };

    const startOnce = () => {
      attempt++;
      t0 = Date.now();
      rec = new Recognition();
      rec.lang = 'de-DE';
      rec.interimResults = false;
      rec.maxAlternatives = 5;
      rec.continuous = false;
      rec.onstart = () => log.push('start');
      rec.onaudiostart = () => log.push('audio');
      rec.onspeechstart = () => log.push('sprache');
      rec.onresult = e => {
        log.push('ergebnis');
        const r = e.results[e.results.length - 1];
        results = Array.from(r, a => a.transcript);
      };
      rec.onerror = e => { log.push('fehler:' + e.error); failed = e.error || 'unbekannt'; finish(); };
      rec.onend = () => { log.push('ende'); finish(); };
      try {
        rec.start();
      } catch (err) {
        log.push('startfehler:' + ((err && err.name) || '?'));
        failed = (err && err.name) || 'start';
        finish();
      }
    };

    button.classList.add('listening');
    $('#lens').classList.add('listening');
    // WICHTIG: direkt im Tipp starten – iPhones blockieren das Mikrofon sonst.
    startOnce();
    // Sicherheitsnetz, falls der Browser nie "fertig" meldet
    safety = setTimeout(() => { try { rec.stop(); } catch { /* egal */ } setTimeout(() => { attempt = 9; finish(); }, 1500); }, 12000);
  });
}

/* ---------------------------------------------------------------- Namen erkennen */
function norm(s) {
  return s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
// Kölner Phonetik: gleiche Codes für ähnlich klingende Wörter ("Glurak" ≈ "Glurack")
function koeln(word) {
  const s = word.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 's').replace(/[^a-z]/g, '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i], prev = s[i - 1] || '', next = s[i + 1] || '';
    let code = '';
    if ('aeijouy'.includes(c)) code = '0';
    else if (c === 'h') code = '-';
    else if (c === 'b') code = '1';
    else if (c === 'p') code = next === 'h' ? '3' : '1';
    else if (c === 'd' || c === 't') code = 'csz'.includes(next) ? '8' : '2';
    else if ('fvw'.includes(c)) code = '3';
    else if ('gkq'.includes(c)) code = '4';
    else if (c === 'c') {
      if (i === 0) code = 'ahkloqrux'.includes(next) ? '4' : '8';
      else code = ('sz'.includes(prev) || !'ahkoqux'.includes(next)) ? '8' : '4';
    } else if (c === 'x') code = 'ckq'.includes(prev) ? '8' : '48';
    else if (c === 'l') code = '5';
    else if (c === 'm' || c === 'n') code = '6';
    else if (c === 'r') code = '7';
    else if ('sz'.includes(c)) code = '8';
    out += code;
  }
  out = out.replace(/-/g, '');
  let res = '';
  for (const ch of out) if (ch !== res[res.length - 1]) res += ch;
  return res[0] + res.slice(1).replace(/0/g, '');
}
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
const STOP = new Set(('wer wie was wo wann warum wieso welche welcher welches ist sind war der die das den dem des ein eine einen einem '
  + 'und oder als auch noch mal bitte mir mich du dich ich er es sie wir ihr zeig zeige erzaehl erzaehle sag sage kannst kann '
  + 'pokedex pokemon pokemons von vom zu zum zur mit gegen gross groesse schwer typ stark staerker schwach entwickelt '
  + 'entwicklung farbe ruf wohnt lebt hat haben macht mehr ueber fuer im in an auf aus dann jetzt hallo hey gibt '
  + 'lieblings lieblingspokemon speicher speichere merk merke sammlung nummer hoch klein lang wiegt schwaechen '
  + 'sich nicht nein ja gut schon viel dass wenn alle aller kommt koennen sein seine sehr so wo wohin woher hier da '
  + 'staerkste staerkstes beste bestes liebste toll cool super danke okay ok oh aeh aehm hm hmm man').split(' '));

// Schreibt ein (bereits normalisiertes) Wort so um, wie es klingt – damit englisch
// verstandene Wörter deutschen Namen ähneln: "sherlock" ≈ "schillok", "tooltalk" ≈ "turtok".
function soundNorm(w) {
  return w
    .replace(/sch/g, 'S').replace(/sh/g, 'S').replace(/ch/g, 'C').replace(/s(?=[ptk])/g, 's')
    .replace(/ph/g, 'f').replace(/th/g, 't').replace(/ck/g, 'k').replace(/qu/g, 'kw')
    .replace(/c(?=[aoukl r])/g, 'k').replace(/c(?=[ei])/g, 'ts').replace(/c$/, 'k')
    .replace(/alk/g, 'ok').replace(/aw/g, 'o').replace(/oo/g, 'u').replace(/ou/g, 'u')
    .replace(/ee/g, 'i').replace(/ea/g, 'i').replace(/ie/g, 'i').replace(/y/g, 'i')
    .replace(/ae/g, 'e').replace(/oe/g, 'o').replace(/ue/g, 'u')
    .replace(/tz/g, 'ts').replace(/z/g, 'ts').replace(/x/g, 'ks').replace(/v/g, 'f').replace(/w/g, 'v')
    .replace(/dt/g, 't').replace(/d$/, 't').replace(/g$/, 'k').replace(/h(?![aeiou])/g, '')
    .replace(/[aeiou]r(?=[^aeiou])/g, m => m[0])   // "r" vor Konsonant hört man kaum
    .replace(/(.)\1+/g, '$1');                       // doppelte Buchstaben
}

function buildIndex() {
  state.keys = [];
  for (const p of state.data.pokemon) {
    for (const name of new Set([p.n, p.en])) {
      if (!name) continue;
      const k = norm(name);
      state.keys.push({ k, sk: soundNorm(k), ph: koeln(name), p, en: name !== p.n });
    }
  }
}
const similarity = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);

// Bewertet ein Wort(-paar) gegen alle Namen. Mit topN > 1 kommen mehrere Vorschläge zurück.
function scoreWindow(w, topN = 1) {
  const learned = state.learned && state.learned[w];
  if (learned && state.byId.has(learned)) return [{ s: 1, p: state.byId.get(learned) }];
  const ph = koeln(w), sw = soundNorm(w);
  const res = [];
  for (const e of state.keys) {
    if (Math.abs(e.k.length - w.length) > 4 && Math.abs(e.sk.length - sw.length) > 3) continue;
    let s;
    if (e.k === w) s = 1;
    else {
      s = similarity(w, e.k);
      if (sw.length >= 3) s = Math.max(s, similarity(sw, e.sk) - 0.04);
      if (w.length >= 5 && ph && ph === e.ph) s = Math.max(s, 0.84);
      if (e.en) s -= 0.05;   // deutsche Namen bevorzugen
    }
    res.push({ s, p: e.p });
  }
  res.sort((a, b) => b.s - a.s);
  const out = [];
  for (const r of res) {
    if (!out.some(o => o.p === r.p)) out.push(r);
    if (out.length >= topN) break;
  }
  return out;
}
function windowsOf(text) {
  const tokens = text.replace(/\bmister\b/gi, 'mr').split(/\s+/).map(norm).filter(t => t && !STOP.has(t));
  const wins = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let len = 1; len <= 3 && i + len <= tokens.length; len++) {
      const w = tokens.slice(i, i + len).join('');
      if (w.length >= 3) wins.push({ w, i, end: i + len, len });
    }
  }
  return wins;
}
// Findet bis zu zwei Pokémon in einem Satz (für Vergleiche "Glurak gegen Turtok").
function findPokemon(text) {
  const nr = text.match(/nummer\s*(\d{1,4})/i);
  if (nr && state.byId.has(+nr[1])) return [state.byId.get(+nr[1])];
  const cands = [];
  for (const win of windowsOf(text)) {
    const [r] = scoreWindow(win.w);
    if (r && r.s >= 0.72) cands.push({ ...r, ...win, rank: r.s + 0.05 * (win.len - 1) });
  }
  cands.sort((a, b) => b.rank - a.rank || b.len - a.len);
  const picked = [];
  for (const c of cands) {
    if (picked.some(x => x.p === c.p || (c.i < x.end && x.i < c.end))) continue;
    if (picked.length && c.s < 0.74) continue;
    picked.push(c);
    if (picked.length === 2) break;
  }
  findPokemon.details = picked;
  return picked.map(c => c.p);
}
// Vorschläge, wenn nichts sicher erkannt wurde: [{p, w}] – w = gehörtes Wort (zum Lernen)
function suggestPokemon(texts) {
  const all = [];
  for (const t of texts) {
    for (const win of windowsOf(t)) {
      for (const r of scoreWindow(win.w, 3)) if (r.s >= 0.5) all.push({ ...r, w: win.w });
    }
  }
  all.sort((a, b) => b.s - a.s);
  const out = [];
  for (const c of all) {
    if (!out.some(o => o.p === c.p)) out.push(c);
    if (out.length === 3) break;
  }
  return out;
}
function learnWord(w, p) {
  if (!w || w.length < 3) return;
  state.learned[w] = p.id;
  save('learned', state.learned);
}

/* ---------------------------------------------------------------- Wissen */
const typeName = id => state.data.types[id];
const typesText = p => {
  const n = p.t.map(typeName);
  return n.length > 1 ? `${n[0]} und ${n[1]}` : n[0];
};
const listText = arr => arr.length <= 1 ? (arr[0] || '') : `${arr.slice(0, -1).join(', ')} und ${arr[arr.length - 1]}`;
const meters = dm => (dm / 10).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const kilos = hg => (hg / 10).toLocaleString('de-DE', { maximumFractionDigits: 1 });

function multiplier(attackType, p) {
  let m = 1;
  for (const d of p.t) {
    const f = state.data.eff[attackType] && state.data.eff[attackType][d];
    if (f !== undefined) m *= f;
  }
  return m;
}
function weaknesses(p) {
  const res = [];
  for (let a = 1; a <= 18; a++) {
    const m = multiplier(a, p);
    if (m > 1) res.push({ a, m });
  }
  return res.sort((x, y) => y.m - x.m);
}
function heightText(p) {
  const cm = p.h * 10, kid = +state.settings.kidHeight;
  let cmp;
  if (cm < 30) cmp = 'Es ist so klein, dass es in eine Schultasche passt.';
  else if (cm < kid * 0.8) cmp = 'Es ist kleiner als du!';
  else if (cm <= kid * 1.15) cmp = 'Es ist ungefähr so groß wie du!';
  else if (cm <= 220) cmp = 'Es ist größer als du, ungefähr so groß wie eine Tür.';
  else if (cm <= 600) cmp = 'Es ist riesig, so groß wie ein Haus!';
  else cmp = 'Es ist gigantisch, höher als ein großer Baum!';
  return `${p.n} ist ${meters(p.h)} Meter groß. ${cmp}`;
}
function weightText(p) {
  const kg = p.w / 10;
  let cmp;
  if (kg < 1) cmp = 'Das ist leichter als eine Packung Milch!';
  else if (kg < 8) cmp = 'Das ist ungefähr so schwer wie eine Katze.';
  else if (kg < 30) cmp = 'Das ist ungefähr so schwer wie du!';
  else if (kg < 120) cmp = 'Das ist so schwer wie ein Erwachsener.';
  else if (kg < 600) cmp = 'Das ist so schwer wie ein Pferd!';
  else cmp = 'Das ist schwerer als ein Auto!';
  return `${p.n} wiegt ${kilos(p.w)} Kilogramm. ${cmp}`;
}
function chainOf(p) {
  return state.data.pokemon.filter(x => x.chain === p.chain);
}
function evolutionText(p) {
  const out = [];
  if (p.from) {
    const pre = state.byId.get(p.from);
    out.push(`${p.n} entwickelt sich aus ${pre.n}${p.how ? ', ' + p.how : ''}.`);
  }
  const next = state.data.pokemon.filter(x => x.from === p.id);
  if (next.length) {
    out.push(`${p.n} entwickelt sich zu ${listText(next.map(n => `${n.n}${n.how ? ' ' + n.how : ''}`))}.`);
  }
  if (!out.length) out.push(`${p.n} entwickelt sich nicht. Es bleibt immer ${p.n}.`);
  return out.join(' ');
}
function weaknessText(p) {
  const w = weaknesses(p);
  if (!w.length) return `${p.n} hat kaum Schwächen. Das ist ein starkes Pokémon!`;
  let t = `Gegen ${p.n} helfen Attacken vom Typ ${listText(w.map(x => typeName(x.a)))}.`;
  const super4 = w.filter(x => x.m >= 4);
  if (super4.length) t += ` ${listText(super4.map(x => typeName(x.a)))} ist sogar besonders stark, viermal so stark!`;
  return t;
}
const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];
function entryText(p, idx = 0) {
  const parts = [];
  const intro = pickOne(['Das ist', 'Schau mal, das ist', 'Oh, das ist', 'Hier ist']);
  parts.push(p.g ? `${intro} ${p.n}, das ${p.g}!` : `${intro} ${p.n}!`);
  parts.push(`${p.n} ist ein Pokémon vom Typ ${typesText(p)}.`);
  if (p.leg === 1) parts.push('Und weißt du was? Es ist ein legendäres Pokémon!');
  if (p.leg === 2) parts.push('Es ist ein ganz geheimnisvolles, mysteriöses Pokémon!');
  if (p.f.length) parts.push(p.f[idx % p.f.length]);
  else parts.push(`Über ${p.n} weiß man noch nicht so viel.`);
  return parts.join(' ');
}
function battleText(a, b) {
  const best = (x, y) => Math.max(...x.t.map(t => multiplier(t, y)));
  const ab = best(a, b), ba = best(b, a);
  const sum = p => p.st.reduce((s, v) => s + v, 0);
  let t = `${a.n} ist vom Typ ${typesText(a)}. ${b.n} ist vom Typ ${typesText(b)}. `;
  let winner = null;
  if (ab > ba) { winner = a; t += `${a.n} hat den Typen-Vorteil!`; }
  else if (ba > ab) { winner = b; t += `${b.n} hat den Typen-Vorteil!`; }
  else {
    const sa = sum(a), sb = sum(b);
    if (Math.abs(sa - sb) < 30) t += 'Die beiden sind ungefähr gleich stark!';
    else { winner = sa > sb ? a : b; t += `${winner.n} hat ein bisschen mehr Kraft.`; }
  }
  if (winner) t += ` Darum hätte ${winner.n} die besseren Chancen.`;
  t += ' Aber mit gutem Training kann jedes Pokémon gewinnen!';
  return t;
}

/* ---------------------------------------------------------------- Absichten */
const INTENTS = [
  ['cry', /\b(ruf|rufen|ruft|geräusch|klingt|schrei|schreit|laut|hören|hoeren)\b|was sagt/],
  ['fav', /lieblings|speicher|merk|sammlung|sammeln/],
  ['evo', /entwick|verwandel|wird (es|er|sie)? ?zu/],
  ['weak', /schwach|schwäche|besieg|stark gegen|hilft gegen|wer schlägt|effektiv|kaputt/],
  ['height', /\bgroß|größe|\bhoch\b|\blang\b|\bklein/],
  ['weight', /schwer|wiegt|gewicht|leicht/],
  ['type', /\btyp|element|was für ein/],
  ['color', /farbe/],
  ['home', /wo (wohnt|lebt|findet|finde|gibt)|zuhause|zu hause/],
  ['more', /mehr|weiter|noch(mal| mal| was)|nochmal/],
  ['random', /zufall|überrasch|irgendein|egal/],
];
function detectIntent(text) {
  const t = text.toLowerCase();
  for (const [name, re] of INTENTS) if (re.test(t)) return name;
  return 'entry';
}

async function answer(transcripts) {
  if (!transcripts.length) {
    $('#heard').textContent = '';
    return speak('Ich habe nichts gehört. Drück auf den grünen Knopf und sprich dann.');
  }
  // Die erste Alternative nehmen, in der ein Pokémon vorkommt.
  let text = transcripts[0], found = [], match = null;
  for (const t of transcripts) {
    const f = findPokemon(t);
    if (f.length) { text = t; found = f; match = findPokemon.details[0]; break; }
  }
  $('#heard').textContent = `„${text}“`;
  const lower = text.toLowerCase();
  const intent = detectIntent(text);

  if (found.length === 2 && /stärker|staerker|gewinn|schlägt|schlaegt|besser|gegen|kampf|kämpf/.test(lower)) {
    showCompare(found[0], found[1]);
    return speak(battleText(found[0], found[1]));
  }
  if (intent === 'random' && !found.length) found = [randomPokemon(9)];
  if (!found.length && /stärkste|staerkste|stärkstes/.test(lower)) {
    const sum = p => p.st.reduce((s, v) => s + v, 0);
    const top = [...state.data.pokemon].sort((a, b) => sum(b) - sum(a))[0];
    state.last = top;
    showEntry(top);
    return speak(`Eines der stärksten Pokémon ist ${top.n}. Es ist ${top.leg === 1 ? 'ein legendäres' : 'ein ganz besonderes'} Pokémon. Aber dein Lieblings-Pokémon kann mit viel Training auch ganz stark werden!`);
  }
  const p = found[0] || (intent !== 'entry' ? state.last : null);
  if (!p) {
    const sug = suggestPokemon(transcripts);
    if (sug.length) {
      showSuggestions(sug, intent);
      return speak('Meintest du eins von diesen Pokémon? Tipp drauf!');
    }
    return speak('Das habe ich leider nicht verstanden. Sag mir einfach den Namen von einem Pokémon!');
  }
  // Bei unsicherer Erkennung andere Möglichkeiten zum Antippen anbieten
  let alts = [];
  if (match && match.s < 0.9) {
    alts = suggestPokemon([match.w]).filter(x => x.p !== p).slice(0, 2).map(x => ({ ...x, w: match.w }));
  }
  return reply(p, intent, found, alts);
}

async function reply(p, intent, found = [p], alts = []) {
  if (p !== state.last) state.flavorIdx = 0;
  state.last = p;
  showEntry(p, alts, intent);

  switch (intent) {
    case 'cry': return playCry(p);
    case 'fav': return addFav(p, true);
    case 'evo': return speak(evolutionText(p));
    case 'weak': return speak(weaknessText(p));
    case 'height': return speak(heightText(p));
    case 'weight': return speak(weightText(p));
    case 'type': return speak(`${p.n} ist ein Pokémon vom Typ ${typesText(p)}.`);
    case 'color': return speak(`${p.n} ist hauptsächlich ${p.c.toLowerCase()}.`);
    case 'home': return speak(p.hab ? `${p.n} lebt ${p.hab}.` : `Wo ${p.n} wohnt, weiß der Pokédex leider nicht.`);
    case 'more':
      if (found.length) break;
      state.flavorIdx++;
      return speak(p.f.length ? p.f[state.flavorIdx % p.f.length] : heightText(p));
  }
  await sfx.dex();
  return speak(entryText(p, state.flavorIdx));
}

/* ---------------------------------------------------------------- Anzeige */
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
const typeBadges = p => p.t.map(t => `<span class="type" style="background:${TYPE_COLORS[t]}">${typeName(t)}</span>`).join('');

function evoRow(p) {
  const chain = chainOf(p);
  if (chain.length < 2) return '';
  // Stufen: Basis -> Stufe 1 -> Stufe 2 (Verzweigungen nebeneinander)
  const depth = x => { let d = 0, c = x; while (c.from && chain.some(y => y.id === c.from)) { d++; c = state.byId.get(c.from); } return d; };
  const stages = [];
  for (const x of chain) (stages[depth(x)] = stages[depth(x)] || []).push(x);
  return `<div class="evo">${stages.map((st, i) =>
    (i ? '<span class="evo-arrow">➜</span>' : '') + st.slice(0, 4).map(x =>
      `<button class="evo-step${x.id === p.id ? ' current' : ''}" data-id="${x.id}"><img src="${SPRITE_BIG(x.id)}" alt="" loading="lazy">${x.n}</button>`).join('')
  ).join('')}</div>`;
}

function showEntry(p, alts = [], intent = 'entry') {
  switchView('ask');
  const isFav = state.favs.includes(p.id);
  const node = el(`
    <div class="entry">
      <div class="entry-head">
        <span class="entry-num">Nr. ${p.id}</span>
        <span class="entry-name">${p.n}</span>
        <button class="star${isFav ? ' on' : ''}" aria-label="Zur Sammlung">⭐</button>
      </div>
      ${alts.length ? `<div class="alts"><span>Falsch? Tipp:</span>${alts.map(a =>
        `<button class="alt" data-id="${a.p.id}" data-w="${a.w}"><img src="${SPRITE_BIG(a.p.id)}" alt="${a.p.n}"></button>`).join('')}</div>` : ''}
      <img class="entry-img" src="${SPRITE_BIG(p.id)}" alt="${p.n}">
      ${p.leg ? `<span class="badge-leg">${p.leg === 1 ? '✨ Legendär' : '✨ Mysteriös'}</span>` : ''}
      <div class="entry-genus">${p.g || ''}</div>
      <div class="types">${typeBadges(p)}</div>
      <div class="facts">
        <button class="fact" data-act="height">📏 ${meters(p.h)} m</button>
        <button class="fact" data-act="weight">⚖️ ${kilos(p.w)} kg</button>
      </div>
      <div class="entry-actions">
        <button class="pill" data-act="read">🔊 Vorlesen</button>
        <button class="pill" data-act="cry">📣 Ruf</button>
        <button class="pill" data-act="weak">⚔️ Schwächen</button>
        <button class="pill" data-act="evo">🔄 Entwicklung</button>
      </div>
      ${evoRow(p)}
    </div>`);
  node.querySelector('.star').onclick = e => { toggleFav(p); e.currentTarget.classList.toggle('on', state.favs.includes(p.id)); };
  node.querySelector('.entry-img').onclick = () => playCry(p);
  node.querySelectorAll('.alt').forEach(b => b.onclick = () => {
    const x = state.byId.get(+b.dataset.id);
    learnWord(b.dataset.w, x);
    reply(x, intent, [x]);
  });
  node.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'read') sfx.dex().then(() => speak(entryText(p, state.flavorIdx++)));
    if (a === 'cry') playCry(p);
    if (a === 'weak') speak(weaknessText(p));
    if (a === 'evo') speak(evolutionText(p));
    if (a === 'height') speak(heightText(p));
    if (a === 'weight') speak(weightText(p));
  });
  node.querySelectorAll('.evo-step').forEach(b => b.onclick = () => {
    const x = state.byId.get(+b.dataset.id);
    state.last = x; state.flavorIdx = 0;
    showEntry(x);
    sfx.dex().then(() => speak(entryText(x)));
  });
  const answerBox = $('#answer');
  answerBox.replaceChildren(node);
  $('#screen').scrollTop = 0;
}

function showSuggestions(sug, intent) {
  switchView('ask');
  const node = el(`
    <div class="entry">
      <div class="entry-name">Meintest du …?</div>
      <div class="suggest">${sug.map(x =>
        `<button class="sug" data-id="${x.p.id}" data-w="${x.w}"><img src="${SPRITE_BIG(x.p.id)}" alt="">${x.p.n}</button>`).join('')}</div>
    </div>`);
  node.querySelectorAll('.sug').forEach(b => b.onclick = () => {
    const x = state.byId.get(+b.dataset.id);
    learnWord(b.dataset.w, x);   // Beim nächsten Mal wird das Wort gleich richtig erkannt
    reply(x, intent, [x]);
  });
  $('#answer').replaceChildren(node);
}

function showCompare(a, b) {
  switchView('ask');
  $('#answer').replaceChildren(el(`
    <div class="entry">
      <div class="compare">
        <figure><img src="${SPRITE_BIG(a.id)}" alt=""><figcaption>${a.n}</figcaption><div class="types">${typeBadges(a)}</div></figure>
        <span class="vs">VS</span>
        <figure><img src="${SPRITE_BIG(b.id)}" alt=""><figcaption>${b.n}</figcaption><div class="types">${typeBadges(b)}</div></figure>
      </div>
    </div>`));
}

function playCry(p) {
  stopSpeaking();
  const tryPlay = url => new Promise((res, rej) => {
    const a = new Audio(url);
    a.volume = 0.6;
    a.onended = res;
    a.onerror = rej;
    a.play().catch(rej);
  });
  return tryPlay(CRY(p.id))
    .catch(() => tryPlay(CRY_LEGACY(p.id)))
    .catch(() => speak(`Den Ruf von ${p.n} kann ich auf diesem Gerät leider nicht abspielen.`));
}

/* ---------------------------------------------------------------- Sammlung */
function toggleFav(p) {
  if (state.favs.includes(p.id)) {
    state.favs = state.favs.filter(id => id !== p.id);
    speak(`${p.n} ist nicht mehr in deiner Sammlung.`);
  } else {
    addFav(p, false);
  }
  save('favs', state.favs);
  renderFavs();
}
function addFav(p, fromVoice) {
  if (!state.favs.includes(p.id)) {
    state.favs.push(p.id);
    save('favs', state.favs);
    renderFavs();
    if (fromVoice) showEntry(p);
    confetti('⭐');
    sfx.right();
    return speak(`Super! ${p.n} ist jetzt in deiner Sammlung.`);
  }
  return speak(`${p.n} ist schon in deiner Sammlung.`);
}
function card(p) {
  const b = el(`<button class="card"><span class="num">${p.id}</span><img src="${SPRITE_BIG(p.id)}" alt="" loading="lazy">${p.n}</button>`);
  b.onclick = () => {
    state.last = p; state.flavorIdx = 0;
    showEntry(p);
    sfx.dex().then(() => speak(entryText(p)));
  };
  return b;
}
function renderFavs() {
  const grid = $('#favGrid');
  grid.replaceChildren(...state.favs.map(id => state.byId.get(id)).filter(Boolean).map(card));
  $('#favEmpty').style.display = state.favs.length ? 'none' : '';
}

/* ---------------------------------------------------------------- Alle Pokémon */
let currentGen = 0;
function renderGenChips() {
  const box = $('#genChips');
  GEN_RANGES.forEach((r, i) => {
    const b = el(`<button>${i + 1}</button>`);
    b.setAttribute('aria-label', `Generation ${i + 1}`);
    b.onclick = () => renderAll(i);
    box.append(b);
  });
}
function renderAll(gen) {
  currentGen = gen;
  document.querySelectorAll('#genChips button').forEach((b, i) => b.classList.toggle('active', i === gen));
  const [from, to] = GEN_RANGES[gen];
  $('#allGrid').replaceChildren(...state.data.pokemon.filter(p => p.id >= from && p.id <= to).map(card));
  $('#view-all').scrollTop = 0;
}

/* ---------------------------------------------------------------- Quiz */
const quiz = { answer: null, solved: false, score: 0, easy: true };
function randomPokemon(maxGen) {
  const max = GEN_RANGES[Math.min(+maxGen, 9) - 1][1];
  return state.byId.get(1 + Math.floor(Math.random() * max));
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function newQuestion() {
  const gen = state.settings.quizGen;
  quiz.answer = randomPokemon(gen);
  quiz.solved = false;
  const img = $('#quizImg');
  img.classList.add('silhouette');
  img.src = SPRITE_BIG(quiz.answer.id);
  $('#quizQ').textContent = 'Wer ist das Pokémon?';
  const choices = [quiz.answer];
  while (choices.length < 3) {
    const c = randomPokemon(gen);
    if (!choices.includes(c)) choices.push(c);
  }
  const box = $('#quizChoices');
  box.style.display = quiz.easy ? '' : 'none';
  box.replaceChildren(...shuffle(choices).map(c => {
    const b = el(`<button aria-label="${c.n}"><img src="${SPRITE_BIG(c.id)}" alt=""></button>`);
    b.onclick = () => guess(c, b);
    return b;
  }));
  speak('Wer ist das Pokémon?');
}
async function guess(p, button) {
  if (quiz.solved) return;
  if (p === quiz.answer) {
    quiz.solved = true;
    quiz.score++;
    $('#quizScore').textContent = `⭐ ${quiz.score}`;
    $('#quizImg').classList.remove('silhouette');
    $('#quizQ').textContent = `Es ist ${p.n}!`;
    document.querySelectorAll('#quizChoices button').forEach(b => {
      if (b.getAttribute('aria-label') === p.n) b.classList.add('right');
    });
    confetti('⭐'); confetti('✨');
    await sfx.right();
    await speak(`Richtig! Es ist ${p.n}!`);
  } else {
    if (button) button.classList.add('wrong');
    await sfx.wrong();
    await speak(button ? `Das ist ${p.n}. Probier es nochmal!` : `Hmm, ${p.n} ist es nicht. Probier es nochmal!`);
  }
}
async function quizListen() {
  const said = await listen($('#quizMic'));
  if (!said) return;
  if (!said.length) return speak('Ich habe nichts gehört. Sag einfach den Namen!');
  for (const t of said) {
    const f = findPokemon(t);
    if (f.includes(quiz.answer)) return guess(quiz.answer);
  }
  const f = findPokemon(said[0]);
  if (f.length) return guess(f[0]);
  if (/weiß nicht|keine ahnung|lösung|verrat|hilfe/.test(said[0].toLowerCase())) return reveal();
  return speak('Das habe ich nicht verstanden. Sag nochmal den Namen!');
}
function reveal() {
  quiz.solved = true;
  $('#quizImg').classList.remove('silhouette');
  $('#quizQ').textContent = `Es ist ${quiz.answer.n}!`;
  return speak(`Das ist ${quiz.answer.n}! Beim nächsten Mal weißt du es bestimmt.`);
}

function confetti(ch) {
  for (let i = 0; i < 10; i++) {
    const s = el(`<span class="confetti">${ch}</span>`);
    s.style.left = '50%'; s.style.top = '45%';
    s.style.setProperty('--dx', `${(Math.random() - 0.5) * 360}px`);
    s.style.setProperty('--dy', `${(Math.random() - 0.7) * 400}px`);
    document.body.append(s);
    setTimeout(() => s.remove(), 1500);
  }
}

/* ---------------------------------------------------------------- Navigation */
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.dex-nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
}

/* ---------------------------------------------------------------- Einstellungen */
function initSettings() {
  const s = state.settings;
  $('#setPreset').value = s.preset;
  $('#setBeeps').checked = s.beeps;
  $('#setQuizGen').value = s.quizGen;
  $('#setKidHeight').value = s.kidHeight;
  const store = () => {
    s.voice = $('#setVoice').value;
    s.preset = $('#setPreset').value;
    s.beeps = $('#setBeeps').checked;
    s.quizGen = $('#setQuizGen').value;
    s.kidHeight = $('#setKidHeight').value;
    save('settings', s);
  };
  ['#setVoice', '#setPreset', '#setBeeps', '#setQuizGen', '#setKidHeight'].forEach(id => $(id).onchange = store);
  $('#btnSettings').onclick = () => $('#settings').showModal();
  $('#setTest').onclick = () => { store(); sfx.dex().then(() => speak(entryText(state.byId.get(25)))); };
  const hints = [];
  if (!Recognition) hints.push('⚠️ Dieser Browser unterstützt keine Spracherkennung. Bitte Chrome (Android) oder Safari (iPhone/iPad) verwenden.');
  if (IS_IOS) hints.push('iPhone/iPad: Für die Spracheingabe muss unter Einstellungen → Allgemein → Tastatur die „Diktierfunktion“ eingeschaltet sein.');
  if (!('speechSynthesis' in window)) hints.push('⚠️ Dieser Browser kann nicht vorlesen.');
  $('#supportHint').textContent = hints.join(' ');
}

/* ---------------------------------------------------------------- Start */
async function init() {
  state.settings = { ...state.settings, ...load('settings', {}) };
  // Umstieg von früheren Versionen: Roboter-Stimme war Standard, jetzt natürliche Stimme
  if (!state.settings.v2) { state.settings.preset = 'natural'; state.settings.voice = ''; state.settings.v2 = true; save('settings', state.settings); }
  state.favs = load('favs', []);
  state.learned = load('learned', {});
  const res = await fetch('data/pokedex-de.json');
  state.data = await res.json();
  for (const p of state.data.pokemon) state.byId.set(p.id, p);
  buildIndex();

  if ('speechSynthesis' in window) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  initSettings();
  renderGenChips();
  renderAll(0);
  renderFavs();

  // Einschalt-Bildschirm: Der erste Tipp gibt Ton und Stimme frei (nötig auf iPhone/iPad),
  // getrennt vom Mikrofon-Knopf, damit sich beides nicht in die Quere kommt.
  $('#boot').onclick = () => {
    ctx();
    $('#boot').classList.add('off');
    sfx.dex().then(() => speak('Hallo! Ich bin dein Pokédex. Drück auf den grünen Knopf und frag mich etwas!'));
    setTimeout(() => $('#boot').remove(), 600);
  };

  $('#toast').onclick = () => $('#toast').classList.remove('show');
  $('#btnMic').onclick = async () => {
    const said = await listen($('#btnMic'));
    if (said) answer(said);
  };
  document.querySelectorAll('.dex-nav button').forEach(b => b.onclick = () => {
    stopSpeaking();
    switchView(b.dataset.view);
    if (b.dataset.view === 'quiz' && !quiz.answer) newQuestion();
  });
  $('#quizMic').onclick = quizListen;
  $('#quizNext').onclick = newQuestion;
  $('#quizMode').onclick = () => {
    quiz.easy = !quiz.easy;
    $('#quizMode').textContent = quiz.easy ? '🖼️ Leicht' : '🎤 Profi';
    $('#quizChoices').style.display = quiz.easy ? '' : 'none';
    speak(quiz.easy ? 'Leicht: Tipp auf das richtige Bild.' : 'Profi: Sag den Namen!');
  };

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// Für Tests in Node exportieren
if (typeof module !== 'undefined') {
  module.exports = { soundNorm, suggestPokemon, learnWord, norm, koeln, lev, findPokemon, detectIntent, state, buildIndex, weaknessText, evolutionText, heightText, weightText, battleText, entryText };
} else {
  init();
}
