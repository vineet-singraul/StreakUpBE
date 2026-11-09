// IP -> approximate location. Uses ipinfo.io when IPINFO_TOKEN is set, otherwise the free ipwho.is.
const cache = new Map(); // ip -> { data, until }
const TTL = 6 * 3600 * 1000;

export function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (fwd || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

const isPrivate = (ip) =>
  !ip || ip === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80)/i.test(ip);

async function lookup(ip) {
  const target = isPrivate(ip) ? '' : ip; // local dev: provider falls back to the server's public IP
  const signal = AbortSignal.timeout(5000);
  if (process.env.IPINFO_TOKEN) {
    const r = await fetch(`https://ipinfo.io/${target ? `${target}/` : ''}json?token=${process.env.IPINFO_TOKEN}`, { signal });
    if (!r.ok) throw new Error(`ipinfo ${r.status}`);
    const d = await r.json();
    const [lat, lon] = String(d.loc || ',').split(',').map(Number);
    return { ip: d.ip, country: d.country, region: d.region, city: d.city, latitude: lat, longitude: lon, isp: d.org, timezone: d.timezone };
  }
  const r = await fetch(`https://ipwho.is/${target}`, { signal });
  const d = await r.json();
  if (!d.success) throw new Error(d.message || 'ip lookup failed');
  return {
    ip: d.ip, country: d.country, region: d.region, city: d.city,
    latitude: d.latitude, longitude: d.longitude,
    isp: d.connection?.isp || d.connection?.org, timezone: d.timezone?.id,
  };
}

export async function geolocateIp(ip) {
  const hit = cache.get(ip);
  if (hit && hit.until > Date.now()) return hit.data;
  const data = await lookup(ip);
  cache.set(ip, { data, until: Date.now() + TTL });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return data;
}
