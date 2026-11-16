/* 모아 통역 웹 — 모아먼트
 * 음성 인식: Web Speech API (SpeechRecognition)
 *   - 데스크톱 Chrome: 마이크 트랙을 여러 언어 인식기에 동시에 넣고(start(track)) 받아 적은 결과를 비교해 언어를 고른다.
 *   - 그 밖의 브라우저(안드로이드·iOS 등): 인식기 하나로 듣고, 못 알아들으면 후보 언어로 "다시 말씀해 주세요"라고 물어 찾는다(앱과 같은 방식).
 * 번역: Chrome 내장 Translator API(기기 안, 무료) → 안 되면 MyMemory 무료 API(키 없음, IP당 하루 한도).
 * 읽어 주기: speechSynthesis.
 */
'use strict';

const LANGS = [
  ['ko-KR', 'ko', '한국어', '한국어', '🇰🇷', 'hangul', '다시 한 번 말씀해 주세요.'],
  ['en-US', 'en', '영어', 'English', '🇺🇸', 'latin', 'Sorry, could you say that again?'],
  ['ja-JP', 'ja', '일본어', '日本語', '🇯🇵', 'kana', 'すみません、もう一度お願いします。'],
  ['zh-CN', 'zh', '중국어', '中文', '🇨🇳', 'han', '对不起，请再说一遍。'],
  ['es-ES', 'es', '스페인어', 'Español', '🇪🇸', 'latin', 'Perdón, ¿puede repetirlo?'],
  ['fr-FR', 'fr', '프랑스어', 'Français', '🇫🇷', 'latin', 'Pardon, pouvez-vous répéter ?'],
  ['de-DE', 'de', '독일어', 'Deutsch', '🇩🇪', 'latin', 'Entschuldigung, können Sie das wiederholen?'],
  ['vi-VN', 'vi', '베트남어', 'Tiếng Việt', '🇻🇳', 'latin', 'Xin lỗi, bạn có thể nói lại không?'],
  ['th-TH', 'th', '태국어', 'ไทย', '🇹🇭', 'thai', 'ขอโทษครับ ช่วยพูดอีกครั้งได้ไหมครับ'],
  ['id-ID', 'id', '인도네시아어', 'Bahasa Indonesia', '🇮🇩', 'latin', 'Maaf, bisa diulang?'],
  ['ru-RU', 'ru', '러시아어', 'Русский', '🇷🇺', 'cyr', 'Извините, повторите, пожалуйста.'],
  ['it-IT', 'it', '이탈리아어', 'Italiano', '🇮🇹', 'latin', 'Scusi, può ripetere?'],
  ['pt-BR', 'pt', '포르투갈어', 'Português', '🇧🇷', 'latin', 'Desculpe, pode repetir?'],
  ['hi-IN', 'hi', '힌디어', 'हिन्दी', '🇮🇳', 'deva', 'माफ़ कीजिए, क्या आप दोबारा बोल सकते हैं?'],
  ['tr-TR', 'tr', '튀르키예어', 'Türkçe', '🇹🇷', 'latin', 'Pardon, tekrar söyler misiniz?'],
  ['ar-SA', 'ar', '아랍어', 'العربية', '🇸🇦', 'arabic', 'عذرًا، هل يمكنك التكرار؟'],
].map(([code, iso, name, native, flag, script, cue]) => ({ code, iso, name, native, flag, script, cue }));
const byCode = c => LANGS.find(l => l.code === c) || LANGS.find(l => l.iso === String(c).slice(0, 2)) || null;
const byIso = i => LANGS.find(l => l.iso === i) || null;
const label = l => `${l.flag} ${l.name}`;

// ---------------------------------------------------------------- 텍스트 분석
function scriptCounts(t) {
  const c = { hangul: 0, kana: 0, han: 0, latin: 0, thai: 0, arabic: 0, cyr: 0, deva: 0, total: 0 };
  for (const ch of t) {
    const r = ch.codePointAt(0);
    let k = null;
    if ((r >= 0xAC00 && r <= 0xD7A3) || (r >= 0x1100 && r <= 0x11FF) || (r >= 0x3130 && r <= 0x318F)) k = 'hangul';
    else if (r >= 0x3040 && r <= 0x30FF) k = 'kana';
    else if ((r >= 0x4E00 && r <= 0x9FFF) || (r >= 0x3400 && r <= 0x4DBF)) k = 'han';
    else if ((r >= 0x41 && r <= 0x5A) || (r >= 0x61 && r <= 0x7A) || (r >= 0xC0 && r <= 0x24F) || (r >= 0x1E00 && r <= 0x1EFF)) k = 'latin';
    else if (r >= 0x0E00 && r <= 0x0E7F) k = 'thai';
    else if (r >= 0x0600 && r <= 0x06FF) k = 'arabic';
    else if (r >= 0x0400 && r <= 0x04FF) k = 'cyr';
    else if (r >= 0x0900 && r <= 0x097F) k = 'deva';
    if (k) { c[k]++; c.total++; }
  }
  return c;
}

/** 받아 적은 글이 그 언어의 글자 체계와 맞는지 */
function consistent(lang, t) {
  const c = scriptCounts(t);
  if (!c.total) return false;
  switch (lang.script) {
    case 'hangul': return c.hangul >= c.total * 0.7;
    case 'kana': return c.kana > 0 && c.kana >= (c.kana + c.han) * 0.3 && c.kana + c.han >= c.total * 0.7;
    case 'han': return c.kana === 0 && c.han >= c.total * 0.7;
    case 'latin': return c.latin >= c.total * 0.8;
    default: return (c[lang.script] || 0) >= c.total * 0.7;
  }
}

/** 대략적인 음절 수 (언어마다 받아 적은 분량을 비교하기 위해) */
function syllables(lang, t) {
  const c = scriptCounts(t);
  switch (lang.script) {
    case 'hangul': return c.hangul;
    case 'kana': return c.kana + c.han * 2;
    case 'han': return c.han;
    case 'latin': return latinSyllables(t);
    default: return c.total / 2.5;
  }
}
function latinSyllables(t) {
  const m = t.toLowerCase().match(/[aeiouyàáâãäåèéêëìíîïòóôõöùúûüýăơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]+/g);
  return m ? m.length : 0;
}

const STOP = {
  en: 'the a an is are was were be to of and in on at for with you i it this that where what how can could please thank thanks my your me do does have has not',
  es: 'el la los las de que y en un una es por para con no se lo le su donde dónde está esta estoy qué cómo muy gracias hay del al',
  fr: 'le la les des de du et est un une que qui pour pas ne je vous il elle où merci avec sur dans ce cette au',
  de: 'der die das und ist nicht ich sie es ein eine zu mit wo was wie danke bitte den dem auf für ist sind haben',
  it: 'il lo la gli le di che e è un una per non sono dove grazie con come mi ti questo questa del della',
  pt: 'o a os as de que e é um uma para com não onde obrigado obrigada por do da está você eu',
  id: 'yang dan di ke dari ini itu tidak apa saya anda kamu terima kasih dengan untuk ada bisa mana',
  vi: 'là và của có không tôi bạn này đó ở được cho với một những cảm ơn đâu gì',
  tr: 've bir bu da de ne için ile mi mı ben sen nerede teşekkür evet hayır çok var',
};
const STOPSETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(' '))]));
const ACCENTS = { es: /[ñ¿¡]/i, fr: /[àâçèêëîïôûùœ]/i, de: /[äöüß]/i, pt: /[ãõ]/i, vi: /[ăơưđạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i, tr: /[ğış]/i };

/** 라틴 문자 글의 언어를 짐작 (불용어 + 특수 문자). {iso, score, margin} */
function guessLatin(t) {
  const words = t.toLowerCase().replace(/[^\p{L}\s']/gu, ' ').split(/\s+/).filter(Boolean);
  const sc = {};
  for (const [iso, set] of Object.entries(STOPSETS)) {
    let n = 0;
    for (const w of words) if (set.has(w)) n++;
    if (ACCENTS[iso] && ACCENTS[iso].test(t)) n += 1.5;
    sc[iso] = n;
  }
  const ranked = Object.entries(sc).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  return { iso: best[1] > 0 ? best[0] : null, score: best[1], margin: best[1] - (second ? second[1] : 0) };
}


// ---------------------------------------------------------------- 소리 비교 (한글·가나 → 대략적인 로마자)
const HG_L = ['g', 'k', 'n', 'd', 't', 'r', 'm', 'b', 'b', 's', 's', '', 'j', 'j', 'ch', 'k', 't', 'p', 'h'];
const HG_V = ['a', 'e', 'ya', 'ye', 'o', 'e', 'yo', 'ye', 'o', 'wa', 'we', 'we', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'u', 'ui', 'i'];
const HG_T = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'm', 'p', 'p', 't', 't', 'n', 't', 't', 'k', 't', 'p', 't'];
function romanizeHangul(t) {
  let o = '';
  for (const ch of t) {
    const c = ch.codePointAt(0) - 0xAC00;
    if (c < 0 || c > 11171) { if (/\s/.test(ch)) o += ' '; continue; }
    o += HG_L[Math.floor(c / 588)] + HG_V[Math.floor((c % 588) / 28)] + HG_T[c % 28];
  }
  return o;
}
const KANA = 'あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso たta ちchi つtsu てte とto なna にni ぬnu ねne のno はha ひhi ふfu へhe ほho まma みmi むmu めme もmo やya ゆyu よyo らra りri るru れre ろro わwa をo んn がga ぎgi ぐgu げge ごgo ざza じji ずzu ぜze ぞzo だda ぢji づzu でde どdo ばba びbi ぶbu べbe ぼbo ぱpa ぴpi ぷpu ぺpe ぽpo ゃya ゅyu ょyo ぁa ぃi ぅu ぇe ぉo ゔvu';
const KANA_MAP = new Map(KANA.split(' ').map(x => [x[0], x.slice(1)]));
function romanizeKana(t) {
  let o = '', dbl = false;
  for (const ch of t) {
    let c = ch.codePointAt(0);
    if (c >= 0x30A1 && c <= 0x30F6) c -= 0x60; // 가타카나 → 히라가나
    const h = String.fromCodePoint(c);
    if (h === 'っ') { dbl = true; continue; }
    if (h === 'ー') continue;
    let r = KANA_MAP.get(h);
    if (r == null) { if (/\s/.test(ch)) o += ' '; continue; }
    if ('ゃゅょ'.includes(h) && o.endsWith('i')) o = o.slice(0, -1);
    if (dbl && r) { r = r[0] + r; dbl = false; }
    o += r;
  }
  return o;
}
/** 소리 골격으로 줄인다: 유성/무성, 장음, 비슷한 모음 등을 같게 본다 */
function phonKey(r) {
  return r.toLowerCase().replace(/\s+/g, '')
    .replace(/sh/g, 's').replace(/ch|ts/g, 'j').replace(/[zj]/g, 'j')
    .replace(/g/g, 'k').replace(/d/g, 't').replace(/[bf]/g, 'p').replace(/l/g, 'r').replace(/v/g, 'p')
    .replace(/w/g, '').replace(/y/g, '').replace(/h/g, '')
    .replace(/(.)\1+/g, '$1').replace(/ng/g, 'n');
}
function similarity(a, b) {
  a = phonKey(a); b = phonKey(b);
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
const hasHiragana = t => /[ぁ-ゖ]/.test(t);

/**
 * 여러 언어 인식기의 결과에서 실제 언어를 고른다.
 * results: [{lang, text, conf}] / allowed: 고를 수 있는 언어들 / mine: 내 언어
 */
function pickLanguage(results, allowed, mine) {
  const score = new Map(allowed.map(l => [l.code, 0]));
  const add = (l, v) => { if (l && score.has(l.code)) score.set(l.code, score.get(l.code) + v); };
  const detail = [];
  const outside = new Map(); // 후보에 없는 라틴 언어로 또렷하게 들린 분량 (예: 후보가 en·ja·zh인데 스페인어)
  for (const r of results) {
    const t = r.text.trim();
    if (!t) continue;
    const L = r.lang;
    const c = scriptCounts(t);
    const latinText = c.total > 0 && c.latin >= c.total * 0.8;
    if (latinText) {
      const g = guessLatin(t);
      const gl = g.iso ? byIso(g.iso) : null;
      if (gl && !score.has(gl.code) && g.margin >= 2) {
        outside.set(gl, (outside.get(gl) || 0) + latinSyllables(t));
        detail.push(`${L.iso}→outside ${g.iso}`);
        continue;
      }
    }
    if (L.script === 'latin') {
      const g = guessLatin(t);
      if (g.iso && g.iso !== L.iso && g.margin >= 1 && score.has(byIso(g.iso)?.code)) {
        // 영어 인식기가 스페인어를 받아 적은 경우 등: 다른 언어에 표를 준다
        add(byIso(g.iso), latinSyllables(t) * 0.8);
        detail.push(`${L.iso}→vote ${g.iso}`);
        continue;
      }
      if (!consistent(L, t)) continue;
      let s = latinSyllables(t) * (g.iso === L.iso ? 1.3 : 1.0);
      if (L.iso === 'en' && r.conf >= 0 && r.conf < 0.4) s *= 0.5; // 영어 인식기는 신뢰도가 의미 있다
      add(L, s);
      detail.push(`${L.iso}=${s.toFixed(1)}`);
    } else if (latinText) {
      // 한국어·중국어 인식기가 영어 문장을 그대로 영어로 적는 경우: 그 라틴 언어에 표
      const g = guessLatin(t);
      const target = g.iso ? byIso(g.iso) : null;
      if (target) { add(target, latinSyllables(t)); detail.push(`${L.iso}→vote ${g.iso}`); }
    } else if (consistent(L, t)) {
      let s = syllables(L, t);
      // 일본어 인식기가 가타카나만 내면 다른 언어를 소리 나는 대로 적은 것이다 (예: 영어 → エクスキューズミー)
      if (L.iso === 'ja' && !hasHiragana(t) && scriptCounts(t).kana >= 4) s *= 0.3;
      add(L, s);
      detail.push(`${L.iso}=${s.toFixed(1)}`);
    }
  }
  // 한국어 인식기가 일본어를 한글로 소리 나는 대로 적은 경우 (스미마셍 ↔ すみません): 일본어 쪽으로 몰아준다
  const koR = results.find(r => r.lang.iso === 'ko' && consistent(r.lang, r.text));
  const jaR = results.find(r => r.lang.iso === 'ja' && hasHiragana(r.text));
  const koL = byIso('ko'), jaL = byIso('ja');
  if (koR && jaR && score.has(koL.code) && score.has(jaL.code)) {
    const sim = similarity(romanizeHangul(koR.text), romanizeKana(jaR.text));
    detail.push(`ko~ja=${sim.toFixed(2)}`);
    if (sim >= 0.55) { score.set(jaL.code, score.get(jaL.code) + score.get(koL.code)); score.set(koL.code, 0); }
  }
  let best = null, bestV = 0;
  for (const [code, v] of score) {
    if (v > bestV || (v === bestV && v > 0 && code === mine.code)) { best = byCode(code); bestV = v; }
  }
  // 후보 밖 언어가 가장 또렷하면, 다른 인식기가 억지로 받아 적은 글을 번역하지 않는다
  let out = null, outV = 0;
  for (const [l, v] of outside) if (v > outV) { out = l; outV = v; }
  if (out && outV >= Math.max(4, best === mine ? bestV * 1.2 : bestV * 0.4)) {
    return { lang: null, outside: out, score: bestV, detail: detail.join(' ') + ` outside=${out.iso}:${outV}` };
  }
  return { lang: bestV >= 2 ? best : null, score: bestV, detail: detail.join(' ') };
}

// ---------------------------------------------------------------- 설정
const store = {
  get(k, d) { try { const v = localStorage.getItem('moa_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('moa_' + k, JSON.stringify(v)); } catch {} },
};
const S = {
  mine: byCode(store.get('mine', 'ko-KR')),
  partnerAuto: store.get('partnerAuto', true),
  partnerFixed: byCode(store.get('partnerFixed', 'en-US')),
  cands: store.get('cands', ['en-US', 'ja-JP', 'zh-CN']),
  rate: store.get('rate', 1.0),
  detected: store.get('detected', null) ? byCode(store.get('detected', null)) : null,
};
function save() {
  store.set('mine', S.mine.code); store.set('partnerAuto', S.partnerAuto); store.set('partnerFixed', S.partnerFixed.code);
  store.set('cands', S.cands); store.set('rate', S.rate); store.set('detected', S.detected ? S.detected.code : null);
}
const candLangs = () => S.cands.map(byCode).filter(l => l && l !== S.mine);
const partner = () => (S.partnerAuto ? S.detected : S.partnerFixed);
const partnerOrGuess = () => partner() || candLangs()[0] || byCode('en-US');
const searching = () => S.partnerAuto && !S.detected;

// ---------------------------------------------------------------- 상태
const q = new URLSearchParams(location.search);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
const isChromeDesktop = !isMobile && /Chrome\//.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);
let mode = q.get('mode') || (isChromeDesktop ? 'parallel' : 'seq'); // parallel | seq
const st = {
  running: false, phase: 'idle', listeningLang: null, notice: null, partial: '',
  stream: null, turns: [], expect: null, tried: new Set(), foreignHeard: false, knownMisses: 0,
  manualOnce: false, round: 0, cueJustSpoken: false,
};
const LOGBUF = [];
window.__mt = { log: LOGBUF }; // 기기 테스트용: 최근 기록
const log = (...a) => {
  LOGBUF.push(new Date().toISOString().slice(11, 19) + ' ' + a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  if (LOGBUF.length > 300) LOGBUF.shift();
  console.log('[MOA]', ...a);
};

// ---------------------------------------------------------------- 번역
const TR = {
  forceMyMemory: q.get('engine') === 'mymemory',
  builtin: 'Translator' in self,
  cache: new Map(),
  progress: new Map(),
  lastEngine: null,
  async getBuiltin(from, to) {
    if (this.forceMyMemory || !this.builtin) return null;
    const key = from.iso + '>' + to.iso;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = (async () => {
      try {
        const a = await Translator.availability({ sourceLanguage: from.iso, targetLanguage: to.iso });
        if (a === 'unavailable') return null;
        if (a !== 'available' && !navigator.userActivation?.isActive) return null; // 다음 탭 때 다시
        const t = await Translator.create({
          sourceLanguage: from.iso, targetLanguage: to.iso,
          monitor: m => m.addEventListener('downloadprogress', e => {
            this.progress.set(key, e.loaded); ui.downloads();
          }),
        });
        this.progress.delete(key); ui.downloads();
        return t;
      } catch (e) {
        log('builtin translator unavailable', key, e.name, e.message);
        this.progress.delete(key); ui.downloads();
        return null;
      }
    })();
    this.cache.set(key, p);
    const t = await p;
    if (!t) this.cache.delete(key);
    return t;
  },
  pending: [],
  /** 모델 다운로드는 사용자 동작(탭·클릭) 한 번에 하나만 시작할 수 있다. 남은 것은 다음 탭 때 시작한다. */
  prewarm(pairs) {
    for (const pr of pairs) if (!this.pending.some(x => x[0] === pr[0] && x[1] === pr[1])) this.pending.push(pr);
    this.kick();
  },
  async kick() {
    if (this.forceMyMemory || !this.builtin) return;
    while (this.pending.length) {
      const [a, b] = this.pending[0];
      const key = a.iso + '>' + b.iso;
      let avail = 'unavailable';
      try { avail = await Translator.availability({ sourceLanguage: a.iso, targetLanguage: b.iso }); } catch {}
      if (avail === 'unavailable') { this.pending.shift(); continue; }
      if (avail === 'available' || this.cache.has(key)) { this.pending.shift(); this.getBuiltin(a, b); continue; }
      // 내려받아야 함: 이번 사용자 동작으로 하나만 시작
      this.pending.shift();
      this.getBuiltin(a, b);
      return;
    }
  },
  async myMemory(text, from, to) {
    const code = l => (l.iso === 'zh' ? 'zh-CN' : l.iso);
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${code(from)}|${code(to)}`;
    // MyMemory 는 응답 시간이 들쭉날쭉하다(같은 요청이 2초~15초 이상). 오래 걸리면 끊고 한 번 더 보낸다.
    const get = async ms => {
      const c = new AbortController();
      const tm = setTimeout(() => c.abort(), ms);
      try { return await fetch(url, { signal: c.signal }); } finally { clearTimeout(tm); }
    };
    try {
      let res;
      try { res = await get(6000); } catch (e) { if (e.name !== 'AbortError') throw e; log('mymemory slow, retry'); res = await get(9000); }
      const j = await res.json();
      if (j.quotaFinished || res.status === 429 || j.responseStatus === 429) {
        throw new Error('오늘 무료 번역 한도를 다 썼어요. 내일 다시 쓰거나, 데스크톱 Chrome(기기 안 번역)에서 열어 주세요.');
      }
      if (j.responseStatus !== 200 || !j.responseData) throw new Error('번역 서버가 응답하지 않아요. 잠시 뒤에 다시 해 주세요.');
      const out = j.responseData.translatedText || '';
      if (/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)) throw new Error('오늘 무료 번역 한도를 다 썼어요. 내일 다시 쓰거나, 데스크톱 Chrome에서 열어 주세요.');
      return out;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('번역 서버 연결이 너무 느려요. 인터넷 연결을 확인해 주세요.');
      throw e;
    }
  },
  async translate(text, from, to) {
    if (from.iso === to.iso) return text;
    // 모델을 내려받는 중이면 기다리지 않고 이번 문장은 MyMemory 로 번역한다
    const t = await Promise.race([this.getBuiltin(from, to), sleep(2500).then(() => null)]);
    if (t) {
      try { const out = await t.translate(text); this.lastEngine = '기기 번역'; return out; } catch (e) { log('builtin translate failed', e.message); }
    }
    const out = await this.myMemory(text, from, to);
    this.lastEngine = 'MyMemory';
    return out;
  },
};

// ---------------------------------------------------------------- 읽어 주기
const TTS = {
  voices: [],
  init() {
    if (!('speechSynthesis' in window)) return;
    const load = () => { this.voices = speechSynthesis.getVoices(); };
    load();
    speechSynthesis.onvoiceschanged = load;
  },
  pick(lang) {
    const norm = v => v.lang.replace('_', '-').toLowerCase();
    const exact = this.voices.filter(v => norm(v) === lang.code.toLowerCase());
    const same = exact.length ? exact : this.voices.filter(v => norm(v).startsWith(lang.iso));
    if (!same.length) return null;
    return same.find(v => /Google|Natural|Online/i.test(v.name)) || same[0];
  },
  speak(text, lang) {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window) || !text) return resolve(false);
      const v = this.pick(lang);
      if (!v && this.voices.length) { setNotice(`${lang.name} 음성이 이 기기에 없어서 글자로만 보여드려요.`); }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang.code;
      if (v) u.voice = v;
      u.rate = S.rate;
      let done = false;
      const finish = ok => { if (!done) { done = true; clearTimeout(guard); resolve(ok); } };
      const guard = setTimeout(() => finish(true), 3000 + text.length * 160 / S.rate);
      u.onend = () => finish(true);
      u.onerror = () => finish(false);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      if (window.__selftest) window.__selftest.onSpeak(text, lang);
    });
  },
};

// ---------------------------------------------------------------- 마이크
async function ensureStream() {
  if (window.__selftest && window.__selftest.fileTrack) return window.__selftest.fileTrack();
  if (st.stream && st.stream.getAudioTracks()[0]?.readyState === 'live') return st.stream.getAudioTracks()[0];
  st.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  return st.stream.getAudioTracks()[0];
}
function releaseStream() {
  if (st.stream) st.stream.getTracks().forEach(t => t.stop());
  st.stream = null;
}

// ---------------------------------------------------------------- 듣기: 병렬 (데스크톱 Chrome)
let activeRecs = [];
function stopRecs() { for (const r of activeRecs) { try { r.abort(); } catch {} } activeRecs = []; }

async function parallelRound(langs, opts = {}) {
  const myRound = ++st.round;
  setPhase('listening', langs.length === 1 ? langs[0] : null);
  const track = await ensureStream();
  const results = []; const errors = {};
  let speechEnd = null, firstFinalAt = null, pending = langs.length, finished = false, startErrors = 0;
  return new Promise(resolve => {
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(maxTimer); clearInterval(settle);
      stopRecs();
      resolve({ results, errors, speechEnd: speechEnd || Date.now(), round: myRound, startErrors });
    };
    const maxTimer = setTimeout(finish, opts.maxMs || 20000);
    // 첫 결과가 나오면 다른 인식기는 끝날 때까지(최대 2.5초) 기다린다
    const settle = setInterval(() => { if (firstFinalAt && Date.now() - firstFinalAt > 2500) finish(); }, 100);
    activeRecs = langs.map(L => {
      const r = new SR();
      r.lang = L.code; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      r.onspeechend = () => { speechEnd ??= Date.now(); };
      r.onresult = e => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const x = e.results[i];
          if (x.isFinal) {
            results.push({ lang: L, text: x[0].transcript, conf: x[0].confidence });
            firstFinalAt ??= Date.now();
          } else if (myRound === st.round) {
            const t = x[0].transcript;
            if (t.length > st.partial.length || L === (st.expect || S.mine)) { st.partial = t; ui.render(); }
          }
        }
      };
      r.onerror = e => { errors[L.code] = e.error; };
      r.onend = () => { if (--pending === 0) finish(); };
      try {
        r.start(track.clone());
      } catch (e) {
        startErrors++;
        log('start(track) failed', e.message);
        if (--pending === 0) finish();
      }
      return r;
    });
    if (window.__selftest) { window.__selftest.onListen(langs); window.__selftest.maybePlay(false); }
  });
}

async function autoLoopParallel() {
  while (st.running && mode === 'parallel') {
    const allowed = [S.mine, ...(partner() ? [partner()] : candLangs())];
    st.partial = '';
    const out = await parallelRound(allowed);
    log('round', JSON.stringify(out.errors), JSON.stringify(out.results.map(r => [r.lang.iso, r.text])), 'startErr', out.startErrors);
    if (!st.running || out.round !== st.round) return;
    if (out.startErrors === allowed.length || Object.values(out.errors).filter(e => e === 'audio-capture' || e === 'not-allowed').length >= 2) {
      log('parallel mode not supported here → seq', out.errors);
      mode = 'seq';
      return autoLoopSeq();
    }
    if (Object.values(out.errors).includes('not-allowed')) { micDenied(); return; }
    if (Object.values(out.errors).includes('network') && !out.results.length) {
      setNotice('음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
      await sleep(1500);
      continue;
    }
    if (!out.results.some(r => r.text.trim())) continue; // 조용함
    const pick = pickLanguage(out.results, allowed, S.mine);
    log('pick', pick.lang?.code, pick.score.toFixed(1), pick.detail, JSON.stringify(out.results.map(r => [r.lang.iso, r.text])));
    if (pick.outside) {
      setNotice(`${pick.outside.name}로 들려요. 설정 ⚙에서 후보 언어에 ${pick.outside.name}를 넣거나 '상대' 버튼을 길게 눌러 고르세요.`);
      if (window.__selftest) window.__selftest.onOutside(pick);
      continue;
    }
    if (!pick.lang) continue;
    const chosen = out.results.filter(r => r.lang === pick.lang).sort((a, b) => b.text.length - a.text.length)[0];
    let text = chosen ? chosen.text : null;
    if (!text) {
      // 그 언어 인식기는 비었고 다른 인식기가 표를 준 경우: 라틴 문장을 그대로 쓴다
      const voter = out.results.find(r => scriptCounts(r.text).latin >= scriptCounts(r.text).total * 0.8 && guessLatin(r.text).iso === pick.lang.iso);
      text = voter ? voter.text : null;
    }
    if (!text) continue;
    await handleUtterance(text.trim(), pick.lang, out.speechEnd, pick);
  }
}

// ---------------------------------------------------------------- 듣기: 하나씩 (모바일 등)
function seqListen(lang) {
  const myRound = ++st.round;
  setPhase('listening', lang);
  st.partial = '';
  return new Promise(async resolve => {
    const r = new SR();
    r.lang = lang.code; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let final = null, err = null, speechStarted = false, speechStart = 0, speechEnd = null;
    r.onspeechstart = () => { speechStarted = true; speechStart = Date.now(); };
    r.onspeechend = () => { speechEnd = Date.now(); };
    r.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const x = e.results[i];
        if (x.isFinal) final = { text: x[0].transcript, conf: x[0].confidence };
        else if (myRound === st.round) { st.partial = x[0].transcript; ui.render(); }
      }
    };
    r.onnomatch = () => { err = 'no-match'; };
    r.onerror = e => { err = e.error; };
    r.onend = () => {
      activeRecs = activeRecs.filter(x => x !== r);
      const heard = speechStarted && (speechEnd || Date.now()) - speechStart > 500;
      resolve({ final, err, heard: heard || err === 'no-match', speechEnd: speechEnd || Date.now(), dur: speechStarted ? (speechEnd || Date.now()) - speechStart : 0, round: myRound });
    };
    activeRecs = [r];
    try {
      if (window.__selftest && window.__selftest.fileTrack) r.start(await ensureStream()); else r.start();
    } catch (e) { err = 'start'; resolve({ final: null, err: 'start', heard: false, speechEnd: Date.now(), round: myRound }); }
    if (window.__selftest) { window.__selftest.onListen([lang]); window.__selftest.maybePlay(st.cueJustSpoken); }
    st.cueJustSpoken = false;
  });
}

// 일본어·중국어를 한글로 소리 나는 대로 적었을 때 자주 나오는 말 (한국어 문장에는 거의 안 나온다)
const JA_IN_HANGUL = /(스미마셍|스미마센|아리가또|아리가토|곤니찌와|곤니치와|오네가이|구다사이|쿠다사이|데스까|데스카|마스까|마스카|마셍|마센|마시타|이마스|데쓰|도꼬|도코데스|와카리|토이레)/;
const ZH_IN_HANGUL = /(니하오|니 하오|씨에씨에|셰셰|쎄쎄|칭원|칭 원|뚜어샤오|두어샤오|짜이나|자이나|워야오|워 야오|니먼|쩌거|저거 뚜|메이요우|메이여우)/;
/** 다른 언어를 억지로 받아 적은 결과인지 (앱과 같은 규칙). [wrong, hint] */
function looksWrong(text, heardAs, durMs) {
  const c = scriptCounts(text);
  const compact = text.replace(/[\s\p{P}]/gu, '');
  if (heardAs.iso === 'ja') return [compact.length >= 4 && c.kana < (c.kana + c.han) * 0.3, 'zh'];
  if (heardAs.iso === 'zh') return [c.kana > 0, 'ja'];
  if (heardAs.script !== 'latin') {
    if (c.total && c.latin >= c.total * 0.8) { const g = guessLatin(text); return [true, g.iso || 'cjk']; }
    if (heardAs.iso === 'ko') {
      // 한국어 인식기는 외국어를 못 알아들었다고 하지 않고 소리 나는 대로 한글로 적는다 (신뢰도도 늘 0.87 정도라 쓸 수 없다)
      if (JA_IN_HANGUL.test(text)) return [true, 'ja'];
      if (ZH_IN_HANGUL.test(text)) return [true, 'zh'];
      const rate = durMs > 0 ? c.hangul * 1000 / durMs : 99; // 한국어는 보통 초당 4~7음절
      if (durMs >= 1000 && rate < 2.6) return [true, null];
    }
    return [!consistent(heardAs, text), null];
  }
  if (c.total && c.latin < c.total * 0.8) {
    if (c.hangul > c.total / 2) return [true, 'ko'];
    if (c.kana) return [true, 'ja'];
    if (c.han) return [true, 'zh'];
    return [true, null];
  }
  const g = guessLatin(text);
  if (g.iso && g.iso !== heardAs.iso && g.margin >= 1.5) return [true, g.iso];
  const cps = durMs > 0 ? compact.length * 1000 / durMs : 99;
  if (durMs >= 1200 && cps < 4.5) return [true, 'cjk'];
  return [false, null];
}

const LATIN_ISO = new Set(['en', 'es', 'fr', 'de', 'it', 'pt', 'id', 'vi', 'tr']);
function searchOrder() {
  const rank = l => (LATIN_ISO.has(l.iso) ? 0 : l.iso === 'ja' ? 1 : l.iso === 'zh' ? 2 : 3);
  return candLangs().map((l, i) => [l, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
}
function nextAfterMiss(r, hint) {
  if (r !== S.mine) st.tried.add(r);
  if (!searching()) {
    st.knownMisses++;
    if (S.partnerAuto && st.knownMisses >= 3) {
      const wrong = S.detected; S.detected = null; st.knownMisses = 0; st.tried = new Set(wrong ? [wrong] : []); save();
      return nextAfterMiss(S.mine, hint);
    }
    return r === S.mine ? partner() : S.mine;
  }
  st.foreignHeard = true;
  const order = searchOrder();
  let pick = null;
  if (hint === 'cjk') pick = order.find(l => (l.iso === 'ja' || l.iso === 'zh') && !st.tried.has(l));
  else if (hint) {
    const h = byIso(hint);
    if (h === S.mine && r !== S.mine) return S.mine;
    if (h && order.includes(h) && !st.tried.has(h)) pick = h;
  }
  pick = pick || order.find(l => !st.tried.has(l));
  if (!pick) { st.tried.clear(); return S.mine; }
  return pick;
}

async function autoLoopSeq() {
  st.expect = st.expect || S.mine;
  while (st.running && mode === 'seq') {
    const lang = st.expect;
    const out = await seqListen(lang);
    if (!st.running || out.round !== st.round) return;
    if (out.err === 'not-allowed' || out.err === 'service-not-allowed') { micDenied(); return; }
    if (out.err === 'network') { setNotice('음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'); await sleep(1500); continue; }
    if (out.err === 'language-not-supported') { setNotice(`이 브라우저는 ${lang.name} 음성 인식을 지원하지 않아요.`); st.expect = S.mine; await sleep(800); continue; }
    if (out.final && out.final.text.trim()) {
      const text = out.final.text.trim();
      const [wrong, hint] = looksWrong(text, lang, out.dur);
      log('seq final', lang.code, text, 'dur=' + out.dur, 'conf=' + (out.final.conf ?? -1).toFixed(2), wrong ? 'rejected hint=' + hint : '');
      if (!wrong) { await handleUtterance(text, lang, out.speechEnd, null); continue; }
      await miss(lang, hint);
      continue;
    }
    if (out.heard) await miss(lang, null);
  }
}

async function miss(r, hint) {
  const next = nextAfterMiss(r, hint);
  st.partial = '';
  setNotice(next === S.mine ? `${r.name}가 아닌 것 같아요. ${S.mine.name}로 다시 들을게요.`
    : searching() ? `외국어가 들렸어요. ${next.name}로 다시 들을게요.` : `${next.name}로 다시 들을게요.`);
  log('miss in', r.code, '->', next.code);
  st.expect = next;
  setPhase('speaking');
  await TTS.speak(next.cue, next);
  st.cueJustSpoken = true;
}

// ---------------------------------------------------------------- 발화 처리
async function handleUtterance(text, from, speechEnd, pick) {
  const isMine = from === S.mine;
  if (!isMine) {
    if (S.partnerAuto && S.detected !== from) { S.detected = from; save(); prewarmTranslators(); }
    st.tried.clear(); st.foreignHeard = false;
  }
  st.knownMisses = 0;
  const to = isMine ? partnerOrGuess() : S.mine;
  const turn = { mine: isMine, from, to, original: text, translated: '', guessed: isMine && !partner(), engine: '' };
  st.turns.push(turn);
  st.partial = ''; st.notice = null;
  setPhase('translating');
  ui.render();
  try {
    turn.translated = await TR.translate(text, from, to);
    turn.engine = TR.lastEngine;
  } catch (e) {
    turn.translated = '';
    setNotice(e.message);
  }
  turn.latency = Date.now() - speechEnd;
  setPhase('speaking');
  ui.render();
  if (window.__selftest) window.__selftest.onTurn(turn, pick);
  if (turn.translated) await TTS.speak(turn.translated, to);
  st.expect = isMine ? (partner() || S.mine) : S.mine;
  if (!st.running) setPhase('idle');
}

// ---------------------------------------------------------------- 시작/정지
function prewarmTranslators() {
  const pairs = [];
  const others = partner() ? [partner()] : candLangs();
  for (const o of others) { pairs.push([o, S.mine], [S.mine, o]); }
  TR.prewarm(pairs);
}

async function startAuto() {
  if (!SR) return;
  prewarmTranslators(); // 클릭(사용자 동작) 안에서 호출해야 모델 다운로드가 허용된다
  try { await ensureStream(); } catch (e) { micDenied(); return; }
  st.running = true; st.notice = null; st.manualOnce = false;
  ui.render();
  if (mode === 'parallel') autoLoopParallel(); else autoLoopSeq();
}
function stopAuto() {
  st.running = false; st.round++;
  stopRecs();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  releaseStream();
  st.partial = '';
  setPhase('idle');
}
async function listenOnce(me, as) {
  const wasRunning = st.running;
  if (wasRunning) { st.running = false; st.round++; stopRecs(); }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  prewarmTranslators();
  const lang = me ? S.mine : (as || partnerOrGuess());
  if (!me && as && S.partnerAuto) { S.detected = as; save(); }
  st.tried.clear(); st.foreignHeard = false; st.notice = null;
  try {
    let text = null, end = Date.now();
    if (mode === 'parallel') {
      const out = await parallelRound([lang]);
      const r = out.results.find(x => x.text.trim());
      if (r) { text = r.text.trim(); end = out.speechEnd; }
    } else {
      const out = await seqListen(lang);
      if (out.final && out.final.text.trim()) { text = out.final.text.trim(); end = out.speechEnd; }
    }
    if (text) await handleUtterance(text, lang, end, null);
    else setNotice(`${lang.name}로 알아듣지 못했어요. 다시 눌러 말씀해 주세요.`);
  } catch (e) { micDenied(); }
  if (wasRunning) startAuto(); else { releaseStream(); setPhase('idle'); }
}
function micDenied() {
  stopAuto();
  setNotice('마이크를 쓸 수 없어요. 주소창의 자물쇠 아이콘에서 마이크를 허용해 주세요.');
}
function pickPartner(l) {
  S.detected = l; S.partnerAuto = true; st.tried.clear(); st.foreignHeard = false; st.notice = null; save();
  prewarmTranslators();
  st.expect = l;
  if (st.running && mode === 'seq') { st.round++; stopRecs(); TTS.speak(l.cue, l).then(() => { st.cueJustSpoken = true; autoLoopSeq(); }); }
  ui.render();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- 화면
const $ = id => document.getElementById(id);
function setPhase(p, lang) { st.phase = p; st.listeningLang = p === 'listening' ? (lang || null) : null; ui.render(); }
function setNotice(t) { st.notice = t; ui.render(); }

const ui = {
  init() {
    $('btnAuto').onclick = () => (st.running ? stopAuto() : startAuto());
    $('btnSettings').onclick = () => { this.fillSettings(); $('settings').showModal(); };
    $('chipMine').onclick = $('btnSettings').onclick;
    $('chipPartner').onclick = e => { if (e.target.id === 'partnerReset') { S.detected = null; save(); this.render(); return; } $('btnSettings').onclick(); };
    $('btnClear').onclick = () => { st.turns = []; this.render(); };
    $('btnMe').onclick = () => listenOnce(true);
    // 상대 버튼: 짧게 누르면 듣기, 길게 누르면 언어 고르기
    let pressTimer = null, longPressed = false;
    const pb = $('btnPartner');
    pb.addEventListener('pointerdown', () => { longPressed = false; pressTimer = setTimeout(() => { longPressed = true; this.openPickOnce(); }, 550); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => pb.addEventListener(ev, () => clearTimeout(pressTimer)));
    pb.addEventListener('click', () => { if (!longPressed) listenOnce(false); });
    pb.addEventListener('contextmenu', e => e.preventDefault());
    this.render();
  },
  openPickOnce() {
    const box = $('pickOnceList'); box.innerHTML = '';
    for (const l of LANGS.filter(l => l !== S.mine)) {
      const b = document.createElement('button'); b.type = 'button';
      b.textContent = `${l.flag}  ${l.name} · ${l.native}`;
      b.onclick = () => { $('pickOnce').close(); listenOnce(false, l); };
      box.appendChild(b);
    }
    $('pickOnce').showModal();
  },
  fillSettings() {
    const opts = (sel, list, cur) => { sel.innerHTML = ''; for (const l of list) { const o = document.createElement('option'); o.value = l.code; o.textContent = `${l.flag}  ${l.name} · ${l.native}`; o.selected = l === cur; sel.appendChild(o); } };
    opts($('selMine'), LANGS, S.mine);
    opts($('selPartner'), LANGS.filter(l => l !== S.mine), S.partnerFixed);
    $('selMine').onchange = e => { S.mine = byCode(e.target.value); S.cands = S.cands.filter(c => c !== S.mine.code); if (!S.cands.length) S.cands = [S.mine.iso === 'en' ? 'ko-KR' : 'en-US']; if (S.detected === S.mine) S.detected = null; save(); this.fillSettings(); this.render(); };
    $('selPartner').onchange = e => { S.partnerFixed = byCode(e.target.value); save(); this.render(); };
    $('segAuto').onclick = () => { S.partnerAuto = true; save(); this.fillSettings(); this.render(); };
    $('segFixed').onclick = () => { S.partnerAuto = false; save(); this.fillSettings(); this.render(); };
    $('segAuto').classList.toggle('on', S.partnerAuto); $('segFixed').classList.toggle('on', !S.partnerAuto);
    $('selPartner').hidden = S.partnerAuto; $('candBox').hidden = !S.partnerAuto;
    const box = $('cands'); box.innerHTML = '';
    for (const l of LANGS.filter(l => l !== S.mine)) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label(l);
      b.classList.toggle('on', S.cands.includes(l.code));
      b.onclick = () => { if (S.cands.includes(l.code)) { if (S.cands.length > 1) S.cands = S.cands.filter(c => c !== l.code); } else S.cands.push(l.code); save(); this.fillSettings(); this.render(); };
      box.appendChild(b);
    }
    $('rate').value = S.rate; $('rateVal').textContent = `${Number(S.rate).toFixed(1)}배`;
    $('rate').oninput = e => { S.rate = Number(e.target.value); $('rateVal').textContent = `${S.rate.toFixed(1)}배`; save(); };
    $('engineInfo').textContent = TR.builtin && !TR.forceMyMemory
      ? '이 브라우저의 내장 번역(기기 안에서 번역, 무료)을 써요. 언어마다 처음 한 번 번역 모델을 내려받아요. 안 되는 언어는 MyMemory 무료 번역을 써요.'
      : 'MyMemory 무료 번역을 써요(인터넷 필요, 하루 사용량 한도가 있어요). 데스크톱 Chrome에서는 기기 안 번역을 쓸 수 있어요.';
    $('capInfo').textContent = !SR ? '음성 인식을 지원하지 않아요.'
      : mode === 'parallel' ? '여러 언어를 동시에 들어서 상대 언어를 첫마디에 알아내요.'
      : '한 번에 한 언어로 들어요. 처음 외국어가 들리면 후보 언어로 "다시 말씀해 주세요"라고 물으며 상대 언어를 찾아요. 상대 언어를 안다면 "직접 고르기"가 가장 빨라요.';
  },
  downloads() {
    const v = [...TR.progress.values()];
    $('dlText').hidden = !v.length;
    if (v.length) $('dlText').textContent = `번역 모델 받는 중 ${Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100)}%`;
  },
  render() {
    const p = partner();
    $('unsupported').hidden = !!SR;
    if (!SR && /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent)) {
      $('unsupported').querySelector('b').textContent = '앱 안 브라우저에서는 음성 인식이 안 돼요.';
      $('unsupported').querySelector('p').textContent = '오른쪽 위(또는 아래) 메뉴에서 "다른 브라우저로 열기"를 눌러 Chrome이나 Safari로 열어 주세요.';
    }
    $('btnAuto').disabled = !SR; $('btnMe').disabled = !SR; $('btnPartner').disabled = !SR;
    $('mineLabel').textContent = label(S.mine);
    $('partnerCaption').textContent = S.partnerAuto ? (p ? '상대 · 감지됨' : '상대 · 찾는 중') : '상대';
    $('partnerLabel').textContent = S.partnerAuto ? (p ? label(p) : '자동 감지') : label(S.partnerFixed);
    $('partnerReset').hidden = !(S.partnerAuto && p);
    const g = partnerOrGuess();
    $('meSub').textContent = label(S.mine);
    $('partnerSub').textContent = label(g) + (p ? '' : ' (추정)');
    const status = $('status');
    status.className = 'status st-' + st.phase;
    const icons = { listening: '🎙', translating: '🔤', speaking: '🔊', idle: '⏸' };
    $('dotIcon').textContent = icons[st.phase] || '⏸';
    $('statusText').textContent = {
      listening: '듣는 중' + (st.listeningLang ? ' · ' + st.listeningLang.name : (mode === 'parallel' && st.running ? ' · ' + [S.mine, ...(p ? [p] : candLangs())].map(l => l.name).join('·') : '')),
      translating: '번역 중', speaking: '말하는 중', idle: st.running ? '대기 중' : '멈춤',
    }[st.phase];
    $('partial').hidden = !st.partial; $('partial').textContent = st.partial;
    $('notice').hidden = !st.notice; $('notice').textContent = st.notice || '';
    $('btnAuto').textContent = st.running ? '■ 자동 통역 멈추기' : '👂 자동 통역 시작';
    $('btnAuto').classList.toggle('on', st.running);
    $('btnMe').classList.toggle('active', st.phase === 'listening' && st.listeningLang === S.mine);
    $('btnPartner').classList.toggle('active', st.phase === 'listening' && st.listeningLang === g);
    // 상대가 자기 언어를 누르는 줄 (하나씩 듣는 방식에서 외국어가 들렸을 때)
    const showPicker = st.running && searching() && st.foreignHeard;
    $('picker').hidden = !showPicker;
    if (showPicker && !$('pickerList').childElementCount) {
      const order = searchOrder();
      for (const l of [...order, ...LANGS.filter(l => l !== S.mine && !order.includes(l))]) {
        const b = document.createElement('button'); b.textContent = `${l.flag} ${l.native}`; b.onclick = () => pickPartner(l);
        $('pickerList').appendChild(b);
      }
    }
    if (!showPicker) $('pickerList').innerHTML = '';
    // 대화
    $('btnClear').hidden = !st.turns.length;
    $('empty').hidden = !!st.turns.length;
    $('emptyTitle').textContent = st.running ? '듣고 있어요. 편하게 대화하세요' : '자동 통역을 켜고 대화를 시작하세요';
    $('emptyText').innerHTML = `외국어가 들리면 ${S.mine.name}로 통역해서 들려주고,<br>내 말은 상대 언어로 바꿔 말해 줘요.`;
    const chat = $('chat');
    const bubbles = chat.querySelectorAll('.bubble');
    if (bubbles.length !== st.turns.length || st.turns.length && bubbles[bubbles.length - 1].dataset.tr !== st.turns[st.turns.length - 1].translated) {
      bubbles.forEach(b => b.remove());
      for (const t of st.turns) chat.appendChild(this.bubble(t));
      chat.scrollTop = chat.scrollHeight;
    }
  },
  bubble(t) {
    const d = document.createElement('div');
    d.className = 'bubble' + (t.mine ? ' mine' : '');
    d.dataset.tr = t.translated;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = `${label(t.from)} → ${label(t.to)}${t.guessed ? '  (상대 언어 추정)' : ''}${t.engine ? '  · ' + t.engine : ''}`;
    const orig = document.createElement('div'); orig.className = 'orig'; orig.textContent = t.original;
    const tr = document.createElement('div'); tr.className = 'tr';
    const b = document.createElement('b'); b.textContent = t.translated || '…';
    tr.appendChild(b);
    if (t.translated) {
      const btn = document.createElement('button'); btn.title = '다시 듣기'; btn.textContent = '🔊';
      btn.onclick = () => TTS.speak(t.translated, t.to);
      tr.appendChild(btn);
    }
    d.append(meta, orig, tr);
    return d;
  },
};

// ---------------------------------------------------------------- 셀프 테스트
// ?selftest=en-US|/path/to/phrase.wav  → 마이크 대신 WAV 를 인식기에 넣고 결과를 [SELFTEST] 로 남긴다
// 옵션: &engine=mymemory (번역 대체 경로 강제), &mode=seq (하나씩 듣기 방식), &reset=1, &mic=1 (WAV 대신 실제/가짜 마이크)
function setupSelftest() {
  const spec = q.get('selftest');
  if (!spec) return;
  const [langCode, wav] = spec.split('|');
  const expected = byCode(langCode);
  const L = (...a) => console.log('[SELFTEST]', ...a);
  const t0 = Date.now();
  let attempts = 0, done = false, ac = null, bufP = null, dst = null;
  if (q.get('reset') === '1') { S.detected = null; save(); }
  if (q.get('cands')) { S.cands = q.get('cands').split(','); save(); }
  window.__selftest = {
    fileTrack: (q.get('mic') === '1' || q.get('acoustic') === '1') ? null : async () => {
      ac ??= new AudioContext();
      bufP ??= fetch(wav).then(r => r.arrayBuffer()).then(b => ac.decodeAudioData(b));
      const buf = await bufP;
      dst ??= ac.createMediaStreamDestination(); // 마이크처럼 계속 살아 있는 트랙 하나
      return dst.stream.getAudioTracks()[0];
    },
    /** 듣기를 시작할 때 부른다: 처음 한 번, 그리고 "다시 말씀해 주세요" 뒤마다 같은 문장을 다시 튼다 */
    async maybePlay(afterCue) {
      if (q.get('mic') === '1' || done || !(attempts === 0 || afterCue)) return;
      if (q.get('acoustic') === '1') {
        // 모바일: 인식기가 트랙을 무시하고 실제 마이크로 들으므로 스피커로 틀어 마이크가 듣게 한다
        attempts++;
        await sleep(Number(q.get('lead') || 300));
        const a = new Audio(wav); a.play().catch(e => L('play err', e.message));
        L(`play(speaker) attempt=${attempts} mode=${mode}`);
        return;
      }
      const buf = await bufP;
      attempts++;
      const src = ac.createBufferSource(); src.buffer = buf; src.connect(dst);
      src.start(ac.currentTime + 0.4);
      L(`play attempt=${attempts} mode=${mode}`);
    },
    onListen(langs) { L('listen', langs.map(l => l.code).join(',')); if (attempts >= 5 && !done) { done = true; L('RESULT FAIL too many attempts'); } },
    onSpeak(text, lang) { L('tts', lang.code, JSON.stringify(text)); },
    onOutside(pick) {
      if (done) return;
      done = true;
      L(`RESULT ${pick.outside === expected ? 'OUTSIDE_OK' : 'OUTSIDE_WRONG'} expected=${expected.code} outside=${pick.outside.code} attempts=${attempts} [${pick.detail}]`);
      setTimeout(stopAuto, 300);
    },
    onTurn(turn, pick) {
      if (done) return;
      done = true;
      L(`RESULT ${turn.from === expected ? 'PASS' : 'WRONG_LANG'} expected=${expected.code} detected=${turn.from.code} attempts=${attempts} mode=${mode}${pick ? ' score=' + pick.score.toFixed(1) + ' [' + pick.detail + ']' : ''}`);
      L(`transcript=${JSON.stringify(turn.original)}`);
      L(`translation(${turn.to.code})=${JSON.stringify(turn.translated)} engine=${turn.engine || '-'}`);
      L(`latency_speechend_to_tts=${turn.latency}ms total=${Date.now() - t0}ms`);
      setTimeout(stopAuto, 300);
    },
  };
  if (q.get('wait') !== '1') setTimeout(startAuto, 600);
}

// ---------------------------------------------------------------- 시작
TTS.init();
ui.init();
document.addEventListener('pointerdown', () => TR.kick(), true);
setupSelftest();
log('mode', mode, 'SR', !!SR, 'Translator', TR.builtin);
