import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc,
  onSnapshot, query, orderBy, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// OMG!!! CONFIG FILA PÅ GITHUBBBB??????  Da går fint, web apien nøkklane til firebase e ikkje hemmelig
const firebaseConfig = {
  apiKey: "AIzaSyBObuELPeZ5t4RGGfyMd9OmKFnKjD_QiGc",
  authDomain: "world-cup-2026-competition.firebaseapp.com",
  projectId: "world-cup-2026-competition",
  storageBucket: "world-cup-2026-competition.firebasestorage.app",
  messagingSenderId: "784919463014",
  appId: "1:784919463014:web:28d86b21e0413132ffd9a7"
};

const ADMIN_USERNAMES = ["torje"];

const EMAIL_DOMAIN = "wc2026.local";
const normUser = (u) => u.trim().toLowerCase();
const userToEmail = (u) => `${normUser(u)}@${EMAIL_DOMAIN}`;
const validUsername = (u) => /^[a-zA-Z0-9_]{3,20}$/.test(u.trim());

const FIXTURES_URL = "https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026/worldcup.json";
const FIXTURES_FALLBACK = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

const LOCALE = "nn-NO";

// Init
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let me = null;            // { uid, username, displayName, isAdmin }
let gamesCache = [];      // siste kamper fra snapshot
let unsubGames = null;

const $ = (id) => document.getElementById(id);
const now = () => Date.now();
const isOpen = (g) => g.kickoff && g.kickoff.toMillis() > now();  

const isKnockout = (g) => (typeof g.knockout === "boolean")
  ? g.knockout
  : !/^gruppe|^group/i.test(g.round || "");
const outcomeOf = (g) => {
  if (g.score1 == null || g.score2 == null) return null;
  return g.score1 > g.score2 ? "1" : g.score1 < g.score2 ? "2" : "X";
};
const fmtKick = (g) => g.kickoff
  ? g.kickoff.toDate().toLocaleString(LOCALE, { weekday:"short", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })
  : "Ikkje sett";
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function toast(msg){
  const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(t._t); t._t = setTimeout(()=>t.classList.add("hidden"), 2600);
}

// Innlogging
let authMode = "login";
$("tabLogin").onclick  = () => setAuthMode("login");
$("tabSignup").onclick = () => setAuthMode("signup");

function setAuthMode(mode){
  authMode = mode;
  $("tabLogin").classList.toggle("active", mode === "login");
  $("tabSignup").classList.toggle("active", mode === "signup");
  $("nameHint").classList.toggle("hidden", mode !== "signup");
  $("authSubmit").textContent = mode === "login" ? "Logg inn" : "Lag brukar";
  $("authError").textContent = "";
}

$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  $("authError").textContent = "";
  const username = $("username").value.trim();
  const password = $("password").value;
  $("authSubmit").disabled = true;
  try {
    if (authMode === "signup") {
      if (!validUsername(username))
        throw new Error("Brukarnamn må vere 3–20 bokstavar, tal eller understrek.");
      const cred = await createUserWithEmailAndPassword(auth, userToEmail(username), password);
      await updateProfile(cred.user, { displayName: username });
      await ensureUserDoc(cred.user, username);
    } else {
      if (!username) throw new Error("Skriv inn brukarnamnet ditt.");
      await signInWithEmailAndPassword(auth, userToEmail(username), password);
    }
  } catch (err) {
    $("authError").textContent = prettyAuthError(err);
  } finally {
    $("authSubmit").disabled = false;
  }
};

function prettyAuthError(err){
  const c = (err.code || "").replace("auth/", "");
  const map = {
    "invalid-credential":"Feil brukarnamn eller passord.",
    "invalid-email":"Brukarnamnet inneheld teikn som ikkje er tillatne.",
    "email-already-in-use":"Brukarnamnet er allereie teke — vel eit anna, eller logg inn.",
    "weak-password":"Passordet må vere minst 6 teikn.",
    "user-not-found":"Ingen brukar med det brukarnamnet.",
    "wrong-password":"Feil passord."
  };
  return map[c] || err.message || "Noko gjekk gale.";
}

$("logoutBtn").onclick = () => signOut(auth);

// Opprett / hent brukerprofilen.
async function ensureUserDoc(user, nameHint){
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const uname = (user.email || "").split("@")[0]; 
  const adminList = ADMIN_USERNAMES.map(normUser);
  const wantAdmin = adminList.includes(uname);
  if (!snap.exists()){
    await setDoc(ref, {
      displayName: nameHint || user.displayName || uname,
      username: uname,
      isAdmin: wantAdmin,
      createdAt: serverTimestamp()
    });
    return { isAdmin: wantAdmin, displayName: nameHint || user.displayName || uname };
  }
  const data = snap.data();
  if (wantAdmin && !data.isAdmin){
    await updateDoc(ref, { isAdmin: true });
    data.isAdmin = true;
  }
  return data;
}

onAuthStateChanged(auth, async (user) => {
  if (!user){
    me = null;
    if (unsubGames) { unsubGames(); unsubGames = null; }
    showApp(false);
    return;
  }
  const profile = await ensureUserDoc(user);
  me = {
    uid: user.uid,
    username: (user.email || "").split("@")[0],
    displayName: profile.displayName || user.displayName || user.email,
    isAdmin: !!profile.isAdmin
  };
  $("whoami").textContent = me.displayName;
  $("adminTab").classList.toggle("hidden", !me.isAdmin);
  showApp(true);
  subscribeGames();
  switchView("games");
});

function showApp(loggedIn){
  $("authView").classList.toggle("hidden", loggedIn);
  $("nav").classList.toggle("hidden", !loggedIn);
  ["gamesView","leaderboardView","adminView"].forEach(v => $(v).classList.add("hidden"));
}

// Navigasjon
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.onclick = () => switchView(btn.dataset.view);
});
function switchView(view){
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.view === view));
  $("gamesView").classList.toggle("hidden", view !== "games");
  $("leaderboardView").classList.toggle("hidden", view !== "leaderboard");
  $("adminView").classList.toggle("hidden", view !== "admin");
  if (view === "leaderboard") renderLeaderboard();
  if (view === "admin") renderAdminGames();
}

// Kamper
function subscribeGames(){
  if (unsubGames) unsubGames();
  const q = query(collection(db, "games"), orderBy("kickoff", "asc"));
  unsubGames = onSnapshot(q, (snap) => {
    gamesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    populateRoundFilter();
    renderGames();
    if (!$("adminView").classList.contains("hidden")) renderAdminGames();
    if (!$("leaderboardView").classList.contains("hidden")) renderLeaderboard();
  }, (err) => { console.error(err); toast("Kunne ikkje laste kampar. Sjekk Firestore-reglane."); });
}

$("roundFilter").onchange = renderGames;
$("onlyOpen").onchange = renderGames;

function populateRoundFilter(){
  const sel = $("roundFilter");
  const current = sel.value;
  const rounds = [...new Set(gamesCache.map(g => g.round).filter(Boolean))];
  sel.innerHTML = '<option value="">Alle rundar</option>' +
    rounds.map(r => `<option>${escapeHtml(r)}</option>`).join("");
  sel.value = current;
}

async function renderGames(){
  const list = $("gamesList");
  const roundF = $("roundFilter").value;
  const onlyOpen = $("onlyOpen").checked;
  let games = gamesCache.filter(g => !roundF || g.round === roundF);
  if (onlyOpen) games = games.filter(isOpen);

  $("gamesEmpty").classList.toggle("hidden", gamesCache.length > 0);
  if (!games.length){ list.innerHTML = ""; return; }

  const myGuesses = {};
  await Promise.all(games.map(async g => {
    const s = await getDoc(doc(db, "games", g.id, "guesses", me.uid));
    if (s.exists()) myGuesses[g.id] = s.data().pick;
  }));

  list.innerHTML = "";
  for (const g of games){
    list.appendChild(await gameCard(g, myGuesses[g.id]));
  }
}

async function gameCard(g, myPick){
  const open = isOpen(g);
  const out = outcomeOf(g);
  const finished = out != null;
  const knockout = isKnockout(g);
  const el = document.createElement("div");
  el.className = "game";

  const status = finished
    ? `<span class="badge done">Ferdig</span>`
    : open ? `<span class="badge open">Open</span>` : `<span class="badge closed">Stengt</span>`;

  const scoreHtml = finished
    ? `<span class="score">${g.score1}</span><span class="vs">–</span><span class="score">${g.score2}</span>`
    : `<span class="vs">mot</span>`;

  el.innerHTML = `
    <div class="game-top">
      <span>${escapeHtml(g.round || "")}</span>
      <span>${fmtKick(g)} ${status}</span>
    </div>
    <div class="match">
      <span>${escapeHtml(g.team1)}</span>${scoreHtml}<span>${escapeHtml(g.team2)}</span>
    </div>`;

  const picks = document.createElement("div");
  picks.className = "picks" + (knockout ? " two" : "");
  const opts = knockout
    ? [["1", g.team1+" vinn"], ["2", g.team2+" vinn"]]
    : [["1", g.team1+" vinn"], ["X","Uavgjort"], ["2", g.team2+" vinn"]];
  for (const [val, label] of opts){
    const b = document.createElement("button");
    b.className = "pick" + (myPick === val ? " selected" : "");
    b.textContent = label;
    if (finished){
      if (val === out) b.classList.add("correct");
      else if (myPick === val) b.classList.add("wrong");
    }
    if (open){
      b.onclick = () => savePick(g, val, picks);
    } else {
      b.disabled = true;
    }
    picks.appendChild(b);
  }
  el.appendChild(picks);

  if (open){
    el.appendChild(note(myPick
      ? "Tippet ditt er lagra og gøymt for andre til kampstart. Trykk for å endre."
      : "Tipp før kampstart. Alle tipp blir gøymde til kampen byrjar."));
  } else {
    el.appendChild(await revealBlock(g, out));
  }
  return el;
}

async function savePick(g, val, picksEl){
  if (!isOpen(g)){ toast("Tippinga er stengd for denne kampen."); return; }
  try {
    await setDoc(doc(db, "games", g.id, "guesses", me.uid), {
      uid: me.uid, displayName: me.displayName, pick: val, updatedAt: serverTimestamp()
    });
    const order = isKnockout(g) ? ["1","2"] : ["1","X","2"];
    [...picksEl.children].forEach((b,i) =>
      b.classList.toggle("selected", order[i] === val));
    toast("Tipp lagra.");
  } catch(e){ console.error(e); toast("Kunne ikkje lagre — tippinga kan akkurat ha stengt."); }
}

async function revealBlock(g, out){
  const wrap = document.createElement("div");
  wrap.className = "reveal";
  let rows = "";
  try {
    const snap = await getDocs(collection(db, "games", g.id, "guesses"));
    const guesses = snap.docs.map(d => d.data());
    guesses.sort((a,b) => (a.displayName||"").localeCompare(b.displayName||""));
    if (!guesses.length){
      rows = `<div class="muted">Ingen tippa denne kampen.</div>`;
    } else {
      const label = { "1": g.team1+" vinn", "X":"Uavgjort", "2": g.team2+" vinn" };
      rows = guesses.map(gu => {
        const cls = out == null ? "" : (gu.pick === out ? "ok" : "no");
        const mark = out == null ? "" : (gu.pick === out ? "✓ +1" : "✗");
        return `<div class="guess-row"><span>${escapeHtml(gu.displayName)}${gu.uid===me.uid?" (deg)":""}</span>
          <span class="res ${cls}">${escapeHtml(label[gu.pick]||gu.pick)} ${mark}</span></div>`;
      }).join("");
    }
  } catch(e){
    rows = `<div class="muted">Kunne ikkje laste tipp.</div>`;
  }
  wrap.innerHTML = `<h4>Tipp${out==null?" (ventar på resultat)":""}</h4>${rows}`;
  return wrap;
}

function note(text){
  const p = document.createElement("p");
  p.className = "locked-note"; p.textContent = text; return p;
}

// Toppliste
const PALETTE = ["#2ea043","#1f6feb","#e3b341","#db61a2","#f85149","#3fb950",
  "#a371f7","#f0883e","#56d4dd","#d2a8ff","#7ee787","#ffa657","#79c0ff","#ff7b72"];

async function renderLeaderboard(){
  const body = $("boardBody");
  body.innerHTML = `<tr><td colspan="5" class="muted center">Reknar …</td></tr>`;

  // alle registrerte spillere
  const usersSnap = await getDocs(collection(db, "users"));
  const players = {};
  usersSnap.forEach(d => {
    const u = d.data();
    players[d.id] = { name: u.displayName || u.username || "Spelar", points:0, correct:0, guessed:0 };
  });

  // ferdigspela kampar i kronologisk rekkjefølgje
  const finished = gamesCache
    .filter(g => outcomeOf(g) != null)
    .sort((a,b) => (a.kickoff?.toMillis()||0) - (b.kickoff?.toMillis()||0));

  // akkumulert poeng-tidslinje per spelar
  const timeline = {};
  Object.keys(players).forEach(uid => { timeline[uid] = []; });

  for (let i = 0; i < finished.length; i++){
    const g = finished[i];
    const out = outcomeOf(g);
    const snap = await getDocs(collection(db, "games", g.id, "guesses"));
    const gained = {};
    snap.forEach(d => {
      const gu = d.data();
      if (!players[gu.uid]){
        players[gu.uid] = { name: gu.displayName||"Spelar", points:0, correct:0, guessed:0 };
        timeline[gu.uid] = new Array(i).fill(0); 
      }
      players[gu.uid].guessed++;
      if (gu.pick === out){ players[gu.uid].points++; players[gu.uid].correct++; gained[gu.uid] = 1; }
    });
    Object.keys(timeline).forEach(uid => {
      const prev = timeline[uid].length ? timeline[uid][timeline[uid].length-1] : 0;
      timeline[uid].push(prev + (gained[uid] ? 1 : 0));
    });
  }

  const ranked = Object.entries(players)
    .map(([uid,p]) => ({ uid, ...p }))
    .sort((a,b) => b.points - a.points || b.correct - a.correct || a.name.localeCompare(b.name));

  $("boardEmpty").classList.toggle("hidden", finished.length > 0);

  body.innerHTML = !ranked.length ? "" : ranked.map((p,i) => `
    <tr class="${p.uid===me.uid?"me":""} ${i===0&&p.points>0?"rank-1":""}">
      <td>${i+1}</td>
      <td>${escapeHtml(p.name)}${p.uid===me.uid?" (deg)":""}</td>
      <td><strong>${p.points}</strong></td>
      <td>${p.correct}</td>
      <td>${p.guessed}</td>
    </tr>`).join("");

  renderPointsChart(finished, timeline, ranked);
}

// Teikn ein SVG-linjegraf for poeng over tid
function renderPointsChart(finished, timeline, ranked){
  const wrap = $("chartWrap"), legend = $("chartLegend"), empty = $("chartEmpty");
  const N = finished.length;
  if (N < 1){ wrap.innerHTML = ""; legend.innerHTML = ""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  const series = ranked.map((p, idx) => ({
    uid: p.uid, name: p.name,
    color: PALETTE[idx % PALETTE.length],
    cum: [0, ...(timeline[p.uid] || [])]  
  }));
  const yMax = Math.max(1, ...series.map(s => s.cum[s.cum.length-1]));

  const W=820, H=380, ml=34, mr=14, mt=14, mb=46;
  const pw=W-ml-mr, ph=H-mt-mb;
  const X = i => ml + pw * i / N;
  const Y = v => mt + ph - ph * v / yMax;

  // y-akse-verdiar (poeng)
  const yStep = Math.max(1, Math.ceil(yMax / 5));
  const yTicks = [];
  for (let v=0; v<=yMax; v+=yStep) yTicks.push(v);
  if (yTicks[yTicks.length-1] !== yMax) yTicks.push(yMax);

  // x-akse-merke (datoar)
  const xStep = Math.max(1, Math.ceil(N / 7));
  const xTicks = [];
  for (let i=1; i<=N; i+=xStep) xTicks.push(i);
  if (xTicks[xTicks.length-1] !== N) xTicks.push(N);

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="ptchart" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Poengutvikling over tid">`;
  yTicks.forEach(v => {
    const y = Y(v);
    svg += `<line x1="${ml}" y1="${y.toFixed(1)}" x2="${W-mr}" y2="${y.toFixed(1)}" class="grid"/>`;
    svg += `<text x="${ml-6}" y="${(y+3).toFixed(1)}" class="ylab">${v}</text>`;
  });
  xTicks.forEach(i => {
    const g = finished[i-1];
    const d = g.kickoff ? g.kickoff.toDate().toLocaleDateString(LOCALE, { day:"numeric", month:"short" }) : String(i);
    svg += `<text x="${X(i).toFixed(1)}" y="${H-mb+20}" class="xlab">${escapeHtml(d)}</text>`;
  });
  const matchLabel = (i) => {
    const g = finished[i-1];
    const d = g.kickoff ? g.kickoff.toDate().toLocaleDateString(LOCALE, { day:"numeric", month:"short" }) : "";
    return `${g.team1} mot ${g.team2}${d?" · "+d:""}`;
  };

  series.slice().reverse().forEach(s => {
    const mine = s.uid === me.uid;
    const pts = s.cum.map((v,i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    svg += `<polyline points="${pts}" class="pline${mine?" me":""}" style="stroke:${s.color}"/>`;
    // prikk på kvart datapunkt (hopp over startpunktet på 0)
    for (let i=1; i<s.cum.length; i++){
      const delta = s.cum[i] - s.cum[i-1];
      svg += `<circle cx="${X(i).toFixed(1)}" cy="${Y(s.cum[i]).toFixed(1)}" r="${mine?4:3}" `
        + `class="pdot${mine?" me":""}" style="fill:${s.color}" `
        + `data-name="${escapeHtml(s.name)}" data-total="${s.cum[i]}" data-delta="${delta}" `
        + `data-match="${escapeHtml(matchLabel(i))}"></circle>`;
    }
  });
  svg += `</svg>`;
  wrap.innerHTML = svg;
  wireChartTooltip(wrap);

  legend.innerHTML = series.map(s =>
    `<span class="lg${s.uid===me.uid?" me":""}"><i style="background:${s.color}"></i>${escapeHtml(s.name)}${s.uid===me.uid?" (deg)":""}</span>`
  ).join("");
}

function wireChartTooltip(wrap){
  let tip = wrap.querySelector(".chart-tip");
  if (!tip){
    tip = document.createElement("div");
    tip.className = "chart-tip";
    wrap.appendChild(tip);
  }
  const svg = wrap.querySelector("svg");
  if (!svg) return;

  const show = (dot, clientX, clientY) => {
    const d = dot.dataset;
    const poeng = `${d.total} poeng`;
    const delta = d.delta === "1" ? " ✓ +1" : "";
    tip.innerHTML = `<b>${d.name}</b><br>${d.match}<br>${poeng}${delta}`;
    const r = wrap.getBoundingClientRect();
    tip.style.left = (clientX - r.left) + "px";
    tip.style.top  = (clientY - r.top) + "px";
    tip.classList.add("show");
  };
  const hide = () => tip.classList.remove("show");

  svg.addEventListener("pointerover", (e) => {
    if (e.target.classList.contains("pdot")) show(e.target, e.clientX, e.clientY);
  });
  svg.addEventListener("pointermove", (e) => {
    if (e.target.classList.contains("pdot")) show(e.target, e.clientX, e.clientY);
  });
  svg.addEventListener("pointerout", (e) => {
    if (e.target.classList.contains("pdot")) hide();
  });
}

// Admin
$("addGameForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!me?.isAdmin) return;
  const t1 = $("ag_team1").value.trim();
  const t2 = $("ag_team2").value.trim();
  const round = $("ag_round").value.trim();
  const kick = $("ag_kickoff").value;
  const knockout = $("ag_knockout").checked;
  if (!t1 || !t2 || !kick) return;
  const id = "manual-" + slug(`${kick}-${t1}-${t2}`);
  await setDoc(doc(db, "games", id), {
    team1:t1, team2:t2, round:round||"Kamp",
    kickoff: Timestamp.fromDate(new Date(kick)),
    knockout: knockout,
    score1:null, score2:null, source:"manual"
  }, { merge:true });
  e.target.reset();
  toast("Kamp lagd til.");
};

function renderAdminGames(){
  if (!me?.isAdmin) return;
  const wrap = $("adminGames");
  if (!gamesCache.length){ wrap.innerHTML = `<p class="muted">Ingen kampar enno — importer eller legg til ein over.</p>`; return; }
  wrap.innerHTML = "";
  for (const g of gamesCache){
    const out = outcomeOf(g);
    const resTxt = out ? ` · resultat: ${out==="1"?"heimesiger":out==="2"?"bortesiger":"uavgjort"}` : "";
    const koTxt = isKnockout(g) ? " · sluttspel" : "";
    const row = document.createElement("div");
    row.className = "ag-row";
    row.innerHTML = `
      <div class="teams">${escapeHtml(g.team1)} mot ${escapeHtml(g.team2)}
        <small>${escapeHtml(g.round||"")} · ${fmtKick(g)}${koTxt}${resTxt}</small></div>
      <input type="number" min="0" value="${g.score1 ?? ""}" placeholder="–" />
      <input type="number" min="0" value="${g.score2 ?? ""}" placeholder="–" />
      <button class="save">Lagra</button>`;
    const [s1, s2] = row.querySelectorAll("input");
    row.querySelector(".save").onclick = async () => {
      const v1 = s1.value === "" ? null : Number(s1.value);
      const v2 = s2.value === "" ? null : Number(s2.value);
      await updateDoc(doc(db, "games", g.id), { score1:v1, score2:v2 });
      toast("Resultat lagra og alle poengrekna på nytt.");
    };
    wrap.appendChild(row);
  }
}

$("importBtn").onclick = async () => {
  if (!me?.isAdmin) return;
  const btn = $("importBtn"); const status = $("importStatus");
  btn.disabled = true; status.textContent = "Hentar program …";
  try {
    let data;
    try { data = await (await fetch(FIXTURES_URL)).json(); }
    catch { data = await (await fetch(FIXTURES_FALLBACK)).json(); }
    const matches = data.matches || [];
    let added = 0, scored = 0;
    for (const m of matches){
      const kickoff = parseKickoff(m.date, m.time);
      const id = "wc-" + slug(`${m.date}-${(m.time||"")}-${m.ground||m.round||m.team1+m.team2}`);
      const payload = {
        team1: m.team1, team2: m.team2,
        round: m.group || m.round || "Kamp",  // openfootball-runde/gruppe
        ground: m.ground || "",
        knockout: !m.group,                 // gruppekamper har 'group'; sluttspill har det ikke
        source: "openfootball"
      };
      if (kickoff) payload.kickoff = kickoff;
      const sc = decideScore(m.score);
      if (sc){ payload.score1 = sc[0]; payload.score2 = sc[1]; scored++; }
      await setDoc(doc(db, "games", id), payload, { merge:true });
      added++;
    }
    status.textContent = `Ferdig — ${added} kampar synkroniserte, ${scored} med resultat.`;
    toast("Kampar importerte.");
  } catch(e){
    console.error(e);
    status.textContent = "Import feila: " + (e.message || e);
  } finally { btn.disabled = false; }
};

function parseKickoff(date, time){
  if (!date) return null;
  let hm = "12:00", off = "+00:00";
  if (time){
    const parts = time.trim().split(/\s+/);
    hm = parts[0] || "12:00";
    const tz = parts[1] || "";                 // f.eks. UTC-6 / UTC+1
    const mtz = tz.match(/UTC([+-]\d{1,2})(?::?(\d{2}))?/i);
    if (mtz){
      const sign = mtz[1][0];
      const h = String(Math.abs(parseInt(mtz[1],10))).padStart(2,"0");
      const mm = mtz[2] || "00";
      off = `${sign}${h}:${mm}`;
    }
  }
  const iso = `${date}T${hm.length===5?hm:("0"+hm).slice(-5)}:00${off}`;
  const d = new Date(iso);
  return isNaN(d) ? null : Timestamp.fromDate(d);
}

function decideScore(score){
  if (!score) return null;
  const s = score.p || score.et || score.ft;
  if (!s || s.length < 2 || s[0] == null || s[1] == null) return null;
  return [s[0], s[1]];
}

// Hjelpefunksjoner
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
