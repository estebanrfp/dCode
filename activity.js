// The year of an identity, one square per day, the way a code host draws it.
// It takes timestamps and gives back markup: no database, no DOM of its own, so
// the page decides where it goes and this file stays a calendar. It is imported
// on demand — only the identity page asks for it, and only when it is opened.
const DAY = 86400000
const WEEKS = 53
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const midnight = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d }

/**
 * A year of activity as an HTML string.
 * @param {number[]} stamps epoch milliseconds, one per event
 * @param {{ what?: string }} [options] the word for one event, singular
 * @returns {string}
 */
export const activityCalendar = (stamps, { what = "commit" } = {}) => {
  const perDay = new Map()
  for (const at of stamps) perDay.set(key(midnight(at)), (perDay.get(key(midnight(at))) ?? 0) + 1)

  // The grid ends on today's column and starts on the Sunday 52 weeks before it,
  // so every column is a full week and the last one is the week you are in.
  const today = midnight(Date.now())
  const end = new Date(today.getTime() + (6 - today.getDay()) * DAY)
  const start = new Date(end.getTime() - (WEEKS * 7 - 1) * DAY)

  const days = Array.from({ length: WEEKS * 7 }, (_, i) => {
    const date = new Date(start.getTime() + i * DAY)
    return { date, n: perDay.get(key(date)) ?? 0, future: date > today }
  })
  const busiest = Math.max(1, ...days.map((d) => d.n))
  const level = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / busiest) * 4)))
  const total = days.reduce((sum, d) => sum + d.n, 0)
  const label = (d) => `${d.n === 0 ? `No ${what}s` : `${d.n} ${what}${d.n === 1 ? "" : "s"}`} on ${d.date.toDateString()}`

  // Columns are weeks, so the cells are laid out column by column and the grid
  // flows down each one — the same order the eye reads a calendar in.
  const cells = days.map((d) => `<i class="cal-day l${level(d.n)}${d.future ? " future" : ""}" title="${label(d)}"></i>`).join("")

  // A month is named over the column where it first appears, once.
  let seen = -1
  const months = Array.from({ length: WEEKS }, (_, w) => {
    const first = days[w * 7].date
    if (first.getMonth() === seen || first.getDate() > 7) return `<span></span>`
    seen = first.getMonth()
    return `<span>${MONTHS[first.getMonth()]}</span>`
  }).join("")

  return `<div class="calendar">
  <p class="cal-total">${total} ${what}${total === 1 ? "" : "s"} in the last year</p>
  <div class="cal-months">${months}</div>
  <div class="cal-body">
    <div class="cal-weekdays"><span>Mon</span><span>Wed</span><span>Fri</span></div>
    <div class="cal-grid" role="img" aria-label="${total} ${what}s in the last year">${cells}</div>
  </div>
  <p class="cal-legend" aria-hidden="true">Less ${[0, 1, 2, 3, 4].map((l) => `<i class="cal-day l${l}"></i>`).join("")} More</p>
</div>`
}
