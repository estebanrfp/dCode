// Two hundred single-file pages — HTML, CSS and JavaScript together, which is
// exactly what dCode hosts. Sixteen kinds of small application over fifty
// subjects: a landing, a form, a to-do list, a board, a price list, questions
// and answers, a timer, a quiz, notes, a bill split, a chart, photographs, a
// menu, a week, a shelf and a sign-up. Every one runs on its own, with no
// framework and nothing fetched — which is what makes them fair previews.
//
// The door's «Seed example projects» brings this module in when it is pressed
// and never before: a visitor who does not ask for them downloads none of it.
// The pages are built here rather than stored, so two hundred of them weigh
// what a couple of them read.

/** [root, what it is, accent, four things it is made of] */
const SUBJECTS = [
  ["aurora-coffee", "A roastery that opens at six", "#c9762f", ["Espresso", "Cortado", "Flat white", "Filter of the week"]],
  ["kite-analytics", "Numbers your team already agrees on", "#4c8dff", ["Live dashboards", "Exports", "Alerts", "Sharing"]],
  ["marta-vidal", "Photographs of people at work", "#8b6f47", ["Portraits", "Kitchens", "Workshops", "Harbours"]],
  ["barra-lenta", "Slow bar, fast coffee", "#7b4b2a", ["Cold brew", "Chemex", "Sourdough toast", "Banana bread"]],
  ["nido-yoga", "Mornings that start on the floor", "#6aa88a", ["Hatha", "Vinyasa", "Yin", "Open floor"]],
  ["papel-libros", "A bookshop with one table", "#a34b4b", ["Essays", "Poetry", "Comics", "Second hand"]],
  ["fold-studio", "Brand work for small teams", "#5b5bd6", ["Identity", "Packaging", "Editorial", "Signage"]],
  ["ritmo-gym", "Twelve people per class, never more", "#e0663d", ["Strength", "Rowing", "Mobility", "Intervals"]],
  ["cero-residuo", "Refill what you already own", "#3f9d6d", ["Detergent", "Shampoo", "Rice", "Olive oil"]],
  ["puerto-tapas", "Twelve plates, written every morning", "#b8482f", ["Boquerones", "Tortilla", "Pimientos", "Vermut"]],
  ["stack-status", "Is it us or is it you", "#2fa8a0", ["Status page", "Incidents", "Webhooks", "History"]],
  ["taller-bici", "Bicycles fixed while you wait", "#c99a2f", ["Tune-up", "Wheel true", "Full service", "Bike fit"]],
  ["mar-de-fondo", "A podcast about the sea", "#2f6fb8", ["Tides", "Nets", "Lighthouses", "Storms"]],
  ["hoja-verde", "Plants that survive an office", "#4e9a4e", ["Pothos", "Sansevieria", "ZZ plant", "Ficus"]],
  ["nocturno-jazz", "Two sets, no reservation", "#7c4dbe", ["Trio", "Quartet", "Jam", "Late set"]],
  ["forma-arquitectura", "Small houses, long light", "#6b7280", ["Cadaques house", "Gracia attic", "Ordesa cabin", "Sea studio"]],
  ["pan-de-ayer", "Bread baked at four", "#c98a2f", ["Country loaf", "Baguette", "Focaccia", "Rye"]],
  ["sencillo-crm", "A customer list that is just a list", "#4c8dff", ["Import", "One pipeline", "Notes", "Reminders"]],
  ["cine-club", "Thursdays, one film, one talk", "#b8402f", ["Wanda", "Playtime", "Naked Island", "La Cienaga"]],
  ["ruta-40", "Guided rides on gravel", "#8a6b2f", ["Sierra loop", "Coast to coast", "Night ride", "Winter route"]],
  ["taza-ceramica", "Wheel-thrown, one at a time", "#a3703f", ["Mug", "Bowl", "Plate", "Jug"]],
  ["clave-legal", "Contracts read by a person", "#3f5b9d", ["Fixed price", "48 hours", "Plain language", "One revision"]],
  ["huerto-urbano", "Vegetables from four streets away", "#4e9a4e", ["Tomatoes", "Chard", "Peppers", "Herbs"]],
  ["sonido-directo", "Live sound for small rooms", "#5b5bd6", ["Monitors", "Front of house", "Recording", "Rental"]],
  ["mesa-larga", "One long table, twenty seats", "#b8482f", ["Menu of the day", "Wine by the glass", "Coffee", "Dessert"]],
  ["nube-fria", "Backups that restore, not just run", "#2fa8a0", ["Snapshots", "Restore drills", "Off-site copy", "Reports"]],
  ["escuela-nado", "Learn to swim at any age", "#2f8ab8", ["Adults", "Children", "Open water", "Technique"]],
  ["luz-tienda", "Lamps made from salvaged glass", "#c9762f", ["Table lamp", "Pendant", "Sconce", "Repairs"]],
  ["andar-caminos", "Walks with a start and an end", "#6aa88a", ["Camino del Norte", "Gredos", "Cabo de Gata", "Ancares"]],
  ["ferro-cafe", "Coffee under the old station roof", "#7b4b2a", ["Espresso", "Cafe con leche", "Carajillo", "Toast"]],
  ["dos-perros", "Dog walking, mornings only", "#8a6b2f", ["Early walk", "Mid morning", "Weekend", "Puppy hour"]],
  ["papelera", "Notebooks bound by hand", "#a34b4b", ["A5 plain", "A5 dotted", "Pocket", "Ledger"]],
  ["borde-mar", "Rooms that look at the water", "#2f6fb8", ["Room one", "Room two", "The attic", "Breakfast"]],
  ["tiempo-real", "Sensors for greenhouses", "#3f9d6d", ["Humidity", "Soil probes", "Alerts", "Reports"]],
  ["boxeo-lento", "Technique before speed", "#e0663d", ["Basics", "Sparring", "Bag work", "Footwork"]],
  ["mil-hojas", "A pastry shop with four things", "#c98a2f", ["Mil hojas", "Palmera", "Napolitana", "Tarta"]],
  ["norte-cine", "Documentaries from the north", "#6b7280", ["Fishermen", "The last forge", "Winter road", "The mine"]],
  ["cuenta-clara", "Invoices for people who hate invoices", "#4c8dff", ["Send", "Chase politely", "Export", "Recurring"]],
  ["raiz-herbolario", "Teas weighed in front of you", "#4e9a4e", ["Manzanilla", "Poleo", "Tila", "Rooibos"]],
  ["luna-danza", "Contemporary dance, open floor", "#7c4dbe", ["Open floor", "Repertoire", "Improvisation", "Contact"]],
  ["mano-carpinteria", "Furniture that can be repaired", "#8b6f47", ["Oak table", "Pine shelves", "Walnut stool", "Repairs"]],
  ["puente-idiomas", "Conversation, not grammar sheets", "#2f8ab8", ["English", "Francais", "Deutsch", "Portugues"]],
  ["salsa-brava", "Six sauces, one potato", "#b8402f", ["Brava", "Alioli", "Mixta", "Picante"]],
  ["viento-sur", "Sailing lessons from the dock", "#2f6fb8", ["First time", "Coastal", "Regatta", "Night sail"]],
  ["tinta-taller", "Screen printing, small runs", "#5b5bd6", ["Posters", "Shirts", "Tote bags", "Stickers"]],
  ["arroz-domingo", "Paella cooked over wood", "#c9762f", ["Valenciana", "Senyoret", "Verduras", "Fideua"]],
  ["clave-musica", "Piano lessons at your pace", "#7c4dbe", ["Beginners", "Sight reading", "Duets", "Theory"]],
  ["orilla-libros", "Second-hand books by the river", "#a34b4b", ["Novels", "Travel", "Cooking", "Children"]],
  ["fuego-lento", "Cooking classes for four people", "#e0663d", ["Stews", "Bread", "Rice", "Preserves"]],
  ["abrigo-lana", "Wool from the same valley", "#8a6b2f", ["Jumpers", "Scarves", "Blankets", "Socks"]],
]

const title = (root) => root.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")

/** The page every shape starts from: one palette, one rhythm, nothing fetched. */
const page = (name, lede, accent, style, body, script) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>
  :root { --accent: ${accent}; --ink: #16181d; --paper: #fbfaf7; --line: #e6e2d9; --muted: #6b7280; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.6 system-ui, sans-serif; }
  main { max-width: 680px; margin: 0 auto; padding: 40px 24px 64px; }
  h1 { margin: 0 0 4px; font-size: 30px; letter-spacing: -.02em; }
  p.lede { margin: 0 0 28px; color: var(--muted); }
  button { font: inherit; padding: 9px 16px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }
  button.quiet { background: none; color: var(--accent); border: 1px solid var(--line); }
  input, select, textarea { font: inherit; width: 100%; padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
${style}
</style>
</head>
<body>
<main>
  <h1>${name}</h1>
  <p class="lede">${lede}</p>
${body}
</main>
<script>
${script}
</script>
</body>
</html>
`

// Sixteen kinds of page. Each one is given the subject's four things and makes
// its own shape out of them, so no two of the two hundred read the same.
const SHAPES = {
  landing: (t, items) => page(t.name, t.lede, t.accent,
`  .hero { padding: 28px; border-radius: 14px; background: linear-gradient(135deg, var(--accent), #ffffff00); color: #fff; }
  ul.points { list-style: none; margin: 24px 0; padding: 0; display: grid; gap: 10px; }
  ul.points li { padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
  .said { margin-top: 20px; font-weight: 600; color: var(--accent); }`,
`  <div class="hero"><h2 style="margin:0">${items[0]}, without the fuss.</h2></div>
  <ul class="points">
${items.map((i) => `    <li>${i}</li>`).join("\n")}
  </ul>
  <button id="ask">Ask for an invite</button>
  <p class="said" id="said"></p>`,
`  let asked = 0
  document.getElementById("ask").onclick = () => {
    asked++
    document.getElementById("said").textContent = asked === 1 ? "You are on the list." : asked + " people asked while you read this."
  }`),

  todo: (t, items) => page(t.name, t.lede, t.accent,
`  form { display: flex; gap: 8px; margin-bottom: 16px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  li.done span { text-decoration: line-through; color: var(--muted); }
  li span { flex: 1; cursor: pointer; }
  .left { margin-top: 16px; color: var(--muted); font-size: 14px; }`,
`  <form id="add"><input id="what" placeholder="Add something to do" aria-label="Add"><button>Add</button></form>
  <ul id="list">
${items.map((i) => `    <li><span>${i}</span><button class="quiet drop">×</button></li>`).join("\n")}
  </ul>
  <p class="left" id="left"></p>`,
`  const list = document.getElementById("list"), left = document.getElementById("left")
  const count = () => { left.textContent = [...list.children].filter((li) => !li.classList.contains("done")).length + " left" }
  list.onclick = (e) => {
    const li = e.target.closest("li"); if (!li) return
    if (e.target.classList.contains("drop")) li.remove(); else li.classList.toggle("done")
    count()
  }
  document.getElementById("add").onsubmit = (e) => {
    e.preventDefault()
    const what = document.getElementById("what")
    if (!what.value.trim()) return
    list.insertAdjacentHTML("beforeend", "<li><span>" + what.value + "</span><button class='quiet drop'>×</button></li>")
    what.value = ""; count()
  }
  count()`),

  board: (t, items) => page(t.name, t.lede, t.accent,
`  .cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .col { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 10px; min-height: 220px; }
  .col h2 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  .card { padding: 10px; margin-bottom: 8px; border-radius: 8px; background: color-mix(in srgb, var(--accent) 10%, #fff); border: 1px solid var(--line); cursor: pointer; font-size: 14px; }
  .card:hover { border-color: var(--accent); }`,
`  <div class="cols" id="board">
    <div class="col" data-col="0"><h2>To do</h2>
${items.map((i) => `      <div class="card">${i}</div>`).join("\n")}
    </div>
    <div class="col" data-col="1"><h2>Doing</h2></div>
    <div class="col" data-col="2"><h2>Done</h2></div>
  </div>
  <p class="lede" style="margin-top:16px">Click a card to move it along.</p>`,
`  const board = document.getElementById("board")
  board.onclick = (e) => {
    const card = e.target.closest(".card"); if (!card) return
    const col = Number(card.closest(".col").dataset.col)
    const next = board.querySelector('[data-col="' + Math.min(col + 1, 2) + '"]')
    next.append(card)
  }`),

  form: (t, items) => page(t.name, t.lede, t.accent,
`  label { display: block; margin: 14px 0 6px; font-size: 13px; color: var(--muted); }
  .out { margin-top: 20px; padding: 14px; border-radius: 10px; background: #fff; border: 1px solid var(--line); display: none; }
  .out.on { display: block; }
  .bad { border-color: #d14; }`,
`  <form id="f">
    <label for="who">Your name</label><input id="who" required>
    <label for="mail">Email</label><input id="mail" type="email" required>
    <label for="what">What do you need?</label>
    <select id="what">
${items.map((i) => `      <option>${i}</option>`).join("\n")}
    </select>
    <label for="more">Anything else</label><textarea id="more" rows="3"></textarea>
    <p><button>Send it</button></p>
  </form>
  <div class="out" id="out"></div>`,
`  document.getElementById("f").onsubmit = (e) => {
    e.preventDefault()
    const who = document.getElementById("who"), mail = document.getElementById("mail")
    const bad = [who, mail].filter((el) => !el.value.trim() || (el.type === "email" && !el.value.includes("@")))
    bad.forEach((el) => el.classList.add("bad"))
    if (bad.length) return
    const out = document.getElementById("out")
    out.className = "out on"
    out.textContent = "Thanks " + who.value + " — we will write to " + mail.value + " about " + document.getElementById("what").value + "."
  }`),

  prices: (t, items) => page(t.name, t.lede, t.accent,
`  .switch { display: flex; gap: 8px; align-items: center; margin-bottom: 20px; font-size: 14px; color: var(--muted); }
  .tiers { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
  .tier { padding: 18px; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
  .tier.best { border-color: var(--accent); }
  .price { font: 700 26px/1.2 system-ui; color: var(--accent); }`,
`  <div class="switch"><button class="quiet" id="cycle">monthly</button><span>or pay for a year and save a sixth</span></div>
  <div class="tiers">
${items.slice(0, 3).map((i, k) => `    <div class="tier${k === 1 ? " best" : ""}"><h2>${i}</h2><p class="price" data-month="${(k + 1) * 9}">9</p><p>${["One project", "Five projects", "Everything"][k]}</p></div>`).join("\n")}
  </div>`,
`  let yearly = false
  document.getElementById("cycle").onclick = (e) => {
    yearly = !yearly
    e.target.textContent = yearly ? "yearly" : "monthly"
    document.querySelectorAll(".price").forEach((p) => {
      const m = Number(p.dataset.month)
      p.textContent = yearly ? (m * 10) + " / year" : m + " / month"
    })
  }
  document.getElementById("cycle").click(); document.getElementById("cycle").click()`),

  faq: (t, items) => page(t.name, t.lede, t.accent,
`  .q { border-bottom: 1px solid var(--line); padding: 14px 0; cursor: pointer; }
  .q h2 { margin: 0; font-size: 15px; }
  .q p { margin: 8px 0 0; color: var(--muted); display: none; }
  .q.open p { display: block; }
  .q.open h2 { color: var(--accent); }`,
`  <div id="faq">
${items.map((i) => `    <div class="q"><h2>${i}?</h2><p>Yes — and if it is not, write to us and we will say so plainly.</p></div>`).join("\n")}
  </div>`,
`  document.getElementById("faq").onclick = (e) => {
    const q = e.target.closest(".q"); if (!q) return
    document.querySelectorAll(".q.open").forEach((o) => o !== q && o.classList.remove("open"))
    q.classList.toggle("open")
  }`),

  timer: (t, items) => page(t.name, t.lede, t.accent,
`  .clock { font: 700 64px/1 ui-monospace, monospace; letter-spacing: -.03em; margin: 20px 0; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .laps { list-style: none; margin: 20px 0 0; padding: 0; color: var(--muted); font-size: 14px; }
  .laps li { padding: 6px 0; border-bottom: 1px solid var(--line); }`,
`  <p class="clock" id="clock">25:00</p>
  <div class="row"><button id="go">Start</button><button class="quiet" id="lap">Note this</button><button class="quiet" id="reset">Reset</button></div>
  <ul class="laps" id="laps">
${items.slice(0, 2).map((i) => `    <li>${i}</li>`).join("\n")}
  </ul>`,
`  let left = 25 * 60, tick = null
  const clock = document.getElementById("clock")
  const draw = () => { clock.textContent = String(Math.floor(left / 60)).padStart(2, "0") + ":" + String(left % 60).padStart(2, "0") }
  document.getElementById("go").onclick = (e) => {
    if (tick) { clearInterval(tick); tick = null; e.target.textContent = "Start"; return }
    e.target.textContent = "Pause"
    tick = setInterval(() => { left = Math.max(0, left - 1); draw(); if (!left) { clearInterval(tick); tick = null } }, 1000)
  }
  document.getElementById("lap").onclick = () => {
    document.getElementById("laps").insertAdjacentHTML("afterbegin", "<li>" + clock.textContent + " — noted</li>")
  }
  document.getElementById("reset").onclick = () => { clearInterval(tick); tick = null; left = 25 * 60; draw(); document.getElementById("go").textContent = "Start" }
  draw()`),

  quiz: (t, items) => page(t.name, t.lede, t.accent,
`  .q { padding: 14px 0; border-bottom: 1px solid var(--line); }
  .q p { margin: 0 0 8px; font-weight: 600; }
  .opt { display: inline-block; margin: 0 8px 8px 0; padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px; cursor: pointer; font-size: 14px; background: #fff; }
  .opt.picked { border-color: var(--accent); color: var(--accent); }
  .score { margin-top: 18px; font-weight: 600; }`,
`  <div id="quiz">
${items.slice(0, 3).map((i, k) => `    <div class="q"><p>${k + 1}. Which one is ${i.toLowerCase()}?</p>
      <span class="opt" data-ok="1">This one</span><span class="opt">That one</span><span class="opt">Neither</span></div>`).join("\n")}
  </div>
  <p class="score" id="score">Pick one in each.</p>`,
`  document.getElementById("quiz").onclick = (e) => {
    const opt = e.target.closest(".opt"); if (!opt) return
    opt.closest(".q").querySelectorAll(".opt").forEach((o) => o.classList.remove("picked"))
    opt.classList.add("picked")
    const picked = document.querySelectorAll(".opt.picked"), right = document.querySelectorAll(".opt.picked[data-ok]")
    document.getElementById("score").textContent = picked.length + " answered · " + right.length + " right"
  }`),

  notes: (t, items) => page(t.name, t.lede, t.accent,
`  textarea { min-height: 90px; }
  ul { list-style: none; margin: 18px 0 0; padding: 0; }
  li { padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: #fff; margin-bottom: 8px; white-space: pre-wrap; }
  li time { display: block; color: var(--muted); font-size: 12px; margin-bottom: 4px; }`,
`  <textarea id="note" placeholder="Write it down before you forget"></textarea>
  <p><button id="keep">Keep it</button></p>
  <ul id="kept">
${items.slice(0, 2).map((i) => `    <li><time>earlier</time>${i}</li>`).join("\n")}
  </ul>`,
`  document.getElementById("keep").onclick = () => {
    const note = document.getElementById("note")
    if (!note.value.trim()) return
    const when = new Date().toLocaleTimeString()
    document.getElementById("kept").insertAdjacentHTML("afterbegin", "<li><time>" + when + "</time>" + note.value + "</li>")
    note.value = ""
  }`),

  split: (t, items) => page(t.name, t.lede, t.accent,
`  .row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; margin: 10px 0; }
  .total { margin-top: 18px; font: 700 26px/1.2 system-ui; color: var(--accent); }
  .who { color: var(--muted); font-size: 14px; }`,
`  <div class="row"><label for="bill">The bill</label><input id="bill" type="number" value="48" style="width:110px"></div>
  <div class="row"><label for="people">Between</label><input id="people" type="number" value="3" min="1" style="width:110px"></div>
  <div class="row"><label for="tip">Round up by</label><input id="tip" type="number" value="10" style="width:110px"></div>
  <p class="total" id="each"></p>
  <p class="who">${items.join(" · ")}</p>`,
`  const each = document.getElementById("each")
  const draw = () => {
    const bill = +document.getElementById("bill").value || 0
    const people = Math.max(1, +document.getElementById("people").value || 1)
    const tip = +document.getElementById("tip").value || 0
    each.textContent = ((bill * (1 + tip / 100)) / people).toFixed(2) + " each"
  }
  document.querySelectorAll("input").forEach((i) => (i.oninput = draw))
  draw()`),

  chart: (t, items) => page(t.name, t.lede, t.accent,
`  .bars { display: grid; gap: 10px; margin: 20px 0; }
  .bar { display: grid; grid-template-columns: 8rem 1fr auto; gap: 10px; align-items: center; font-size: 14px; }
  .track { height: 12px; border-radius: 999px; background: #eee9df; overflow: hidden; }
  .fill { height: 100%; background: var(--accent); width: 0; transition: width .5s ease; }`,
`  <div class="bars" id="bars">
${items.map((i, k) => `    <div class="bar"><span>${i}</span><span class="track"><span class="fill" data-to="${20 + k * 22}"></span></span><b>${20 + k * 22}%</b></div>`).join("\n")}
  </div>
  <button id="again">Measure again</button>`,
`  const draw = () => document.querySelectorAll(".fill").forEach((f) => {
    const to = Math.min(98, Math.max(6, Number(f.dataset.to) + Math.round(Math.random() * 20 - 10)))
    f.style.width = to + "%"; f.parentElement.nextElementSibling.textContent = to + "%"
  })
  document.getElementById("again").onclick = draw
  requestAnimationFrame(draw)`),

  gallery: (t, items) => page(t.name, t.lede, t.accent,
`  .frames { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .frame { aspect-ratio: 4 / 3; border-radius: 10px; background: linear-gradient(135deg, var(--accent), #ffffff66); display: grid; place-items: end start; padding: 10px; color: #fff; font-size: 13px; cursor: pointer; }
  .frame.on { outline: 3px solid var(--ink); }`,
`  <div class="frames" id="frames">
${items.map((i) => `    <div class="frame">${i}</div>`).join("\n")}
  </div>
  <p class="lede" id="picked" style="margin-top:16px">Pick one.</p>`,
`  document.getElementById("frames").onclick = (e) => {
    const frame = e.target.closest(".frame"); if (!frame) return
    document.querySelectorAll(".frame.on").forEach((f) => f.classList.remove("on"))
    frame.classList.add("on")
    document.getElementById("picked").textContent = frame.textContent + " — ask about this one."
  }`),

  menu: (t, items) => page(t.name, t.lede, t.accent,
`  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px dashed var(--line); }
  li.gone { opacity: .4; text-decoration: line-through; }
  .note { margin-top: 16px; color: var(--muted); font-size: 14px; }`,
`  <ul id="menu">
${items.map((i, k) => `    <li><span>${i}</span><b>${(1.4 + k * 0.9).toFixed(2)}</b></li>`).join("\n")}
  </ul>
  <p><button id="sold">Mark the first one sold out</button></p>
  <p class="note" id="note">Written every morning.</p>`,
`  const list = document.getElementById("menu")
  document.getElementById("sold").onclick = () => {
    const next = [...list.children].find((li) => !li.classList.contains("gone"))
    if (!next) return document.getElementById("note").textContent = "That is everything, for today."
    next.classList.add("gone")
  }`),

  week: (t, items) => page(t.name, t.lede, t.accent,
`  table { width: 100%; border-collapse: collapse; }
  td { padding: 12px 0; border-bottom: 1px solid var(--line); }
  td:last-child { text-align: right; color: var(--accent); font-weight: 600; cursor: pointer; }
  td.full { color: var(--muted); font-weight: 400; cursor: default; }
  .seats { margin-top: 16px; color: var(--muted); font-size: 14px; }`,
`  <table id="slots">
${items.map((i, k) => `    <tr><td>${["Mon", "Tue", "Thu", "Sat"][k]} ${["07:00", "19:00", "07:30", "10:00"][k]} · ${i}</td><td>book</td></tr>`).join("\n")}
  </table>
  <p class="seats" id="seats">Places left this week: <b>12</b></p>`,
`  let left = 12
  document.getElementById("slots").onclick = (e) => {
    if (e.target.tagName !== "TD" || e.target.textContent !== "book") return
    e.target.textContent = "booked"; e.target.classList.add("full")
    document.getElementById("seats").innerHTML = "Places left this week: <b>" + --left + "</b>"
  }`),

  shelf: (t, items) => page(t.name, t.lede, t.accent,
`  ul { list-style: none; margin: 16px 0 0; padding: 0; }
  li { padding: 12px 0; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; }
  li[hidden] { display: none; }
  .none { color: var(--muted); display: none; }
  .none.on { display: block; }`,
`  <input id="q" placeholder="Search the shelf" aria-label="Search">
  <ul id="items">
${items.map((i, k) => `    <li><span>${i}</span><b>${8 + k * 3}</b></li>`).join("\n")}
  </ul>
  <p class="none" id="none">Nothing with that name.</p>`,
`  const items = [...document.getElementById("items").children], none = document.getElementById("none")
  document.getElementById("q").oninput = (e) => {
    const q = e.target.value.trim().toLowerCase()
    items.forEach((li) => (li.hidden = !!q && !li.textContent.toLowerCase().includes(q)))
    none.className = items.every((li) => li.hidden) ? "none on" : "none"
  }`),

  signup: (t, items) => page(t.name, t.lede, t.accent,
`  form { display: flex; gap: 8px; margin: 16px 0; }
  .queue { list-style: none; margin: 0; padding: 0; color: var(--muted); font-size: 14px; }
  .queue li { padding: 8px 0; border-bottom: 1px solid var(--line); }
  .count { font: 700 22px/1.2 system-ui; color: var(--accent); }`,
`  <p class="count" id="count">${items.length} people ahead of you</p>
  <form id="join"><input id="mail" type="email" placeholder="you@example.com" aria-label="Email"><button>Join</button></form>
  <ul class="queue" id="queue">
${items.map((i) => `    <li>${i} · joined earlier</li>`).join("\n")}
  </ul>`,
`  let ahead = ${items.length}
  document.getElementById("join").onsubmit = (e) => {
    e.preventDefault()
    const mail = document.getElementById("mail")
    if (!mail.value.includes("@")) return mail.focus()
    document.getElementById("queue").insertAdjacentHTML("afterbegin", "<li>" + mail.value + " · just now</li>")
    document.getElementById("count").textContent = ++ahead + " people ahead of you"
    mail.value = ""
  }`),
}

// What each kind is called and what it says it is, so a name reads as a project
// and not as a template. Four kinds per subject: two hundred in all.
const KIND = {
  landing: ["", (n) => `The page for ${n}`],
  todo: ["tasks", (n) => `What to do at ${n}, before opening`],
  board: ["board", (n) => `The board the ${n} team moves on Mondays`],
  form: ["contact", (n) => `Ask ${n} something, without an account`],
  prices: ["prices", (n) => `What ${n} charges, and for what`],
  faq: ["faq", (n) => `Questions people ask ${n}`],
  timer: ["timer", (n) => `The twenty-five minutes ${n} works in`],
  quiz: ["quiz", (n) => `How well do you know ${n}?`],
  notes: ["notes", (n) => `Notes kept at ${n}`],
  split: ["split", (n) => `Split the bill at ${n}`],
  chart: ["numbers", (n) => `${n} in four numbers`],
  gallery: ["shots", (n) => `Photographs from ${n}`],
  menu: ["menu", (n) => `What ${n} serves today`],
  week: ["week", (n) => `The week at ${n}`],
  shelf: ["shelf", (n) => `The shelf at ${n}`],
  signup: ["waitlist", (n) => `Join the list at ${n}`],
}
const KINDS = Object.keys(KIND)

/** The two hundred projects, each as { name, description, html }. */
export const examples = () =>
  SUBJECTS.flatMap(([root, lede, accent, items], s) =>
    [0, 1, 2, 3].map((k) => {
      const kind = KINDS[(s * 4 + k) % KINDS.length]
      const [suffix, says] = KIND[kind]
      const name = suffix ? `${root}-${suffix}` : root
      const human = title(root)
      return {
        name,
        description: kind === "landing" ? lede : says(human),
        html: SHAPES[kind]({ name: human, lede: kind === "landing" ? lede : says(human), accent }, items),
      }
    }))
