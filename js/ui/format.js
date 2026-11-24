// Display helpers. Times are always shown in Delaware time, whatever the viewer's timezone.
const TZ = 'America/New_York';
const tf = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const hf = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric' });

export const time = d => tf.format(d);                                       // 4:43 PM
export const short = d => tf.format(d).replace(':00', '').replace(' AM', 'a').replace(' PM', 'p'); // 4:43p / 5p
export const hour = d => hf.format(d).replace(' AM', 'a').replace(' PM', 'p'); // 5p
export const range = (a, b) => {
  const A = time(a), B = time(b);
  return A.slice(-2) === B.slice(-2) ? `${A.slice(0, -3)} – ${B}` : `${A} – ${B}`;
};

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = deg => (Number.isFinite(deg) ? POINTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16] : '');
export const ft = v => `${v.toFixed(1)} ft`;
export const mins = m => (m < 60 ? `${m} min` : m % 60 === 0 || m >= 180 ? `${Math.round(m / 60)} hr` : `${Math.floor(m / 60)} hr ${m % 60} min`);
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const SOURCE_TAG = { obs: 'Observed', fcst: 'Forecast', model: 'Model forecast', est: 'Estimate' };
