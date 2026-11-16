// IP -> approximate location, no browser permission needed.
// Accuracy: one provider alone often returns the wrong city (ISP hub / mobile gateway), so several
// free providers are asked in parallel and the city most of them agree on wins.
// IPINFO_TOKEN in .env is optional (raises ipinfo's free limit).
const cache = new Map(); // ip -> { data, until }
const TTL = 6 * 3600 * 1000;

export function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (fwd || req.headers['x-real-ip'] || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

const isPrivate = (ip) =>
  !ip || ip === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80)/i.test(ip);

// Two-letter country code -> flag emoji (regional indicator letters)
function flagFromCode(code) {
  if (!/^[A-Za-z]{2}$/.test(code || '')) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// Each provider returns the same shape. Earlier = higher priority when votes tie.
const providers = [
  {
    name: 'ipinfo',
    // Works without a token too (lower daily limit); IPINFO_TOKEN raises it to 50k/month
    async get(ip) {
      const token = process.env.IPINFO_TOKEN ? `?token=${process.env.IPINFO_TOKEN}` : '';
      const d = await getJson(`https://ipinfo.io/${ip ? `${ip}/` : ''}json${token}`);
      if (!d.city) throw new Error('ipinfo: no city');
      const [lat, lon] = String(d.loc || ',').split(',').map(Number);
      return {
        ip: d.ip, country: d.country, countryCode: d.country, region: d.region, city: d.city,
        postal: d.postal, latitude: lat, longitude: lon, isp: d.org, timezone: d.timezone,
      };
    },
  },
  {
    name: 'ip-api',
    // Free tier is HTTP only; fine here because this call is server-to-server
    async get(ip) {
      const d = await getJson(
        `http://ip-api.com/json/${ip}?fields=status,message,query,country,countryCode,regionName,city,zip,lat,lon,timezone,offset,isp,org,as,continent`,
      );
      if (d.status !== 'success') throw new Error(`ip-api: ${d.message}`);
      return {
        ip: d.query, country: d.country, countryCode: d.countryCode, region: d.regionName, city: d.city,
        postal: d.zip, continent: d.continent, latitude: d.lat, longitude: d.lon, isp: d.isp, org: d.org,
        asn: d.as, timezone: d.timezone,
      };
    },
  },
  {
    name: 'ipwho',
    async get(ip) {
      const d = await getJson(`https://ipwho.is/${ip}`);
      if (!d.success) throw new Error(`ipwho: ${d.message}`);
      return {
        ip: d.ip, country: d.country, countryCode: d.country_code, region: d.region, city: d.city,
        postal: d.postal, continent: d.continent, latitude: d.latitude, longitude: d.longitude,
        isp: d.connection?.isp || d.connection?.org, org: d.connection?.org, asn: d.connection?.asn,
        timezone: d.timezone?.id, utcOffset: d.timezone?.utc, flag: d.flag?.emoji,
      };
    },
  },
  {
    name: 'ipapi.co',
    async get(ip) {
      const d = await getJson(`https://ipapi.co/${ip ? `${ip}/` : ''}json/`);
      if (d.error) throw new Error(`ipapi.co: ${d.reason}`);
      return {
        ip: d.ip, country: d.country_name, countryCode: d.country_code, region: d.region, city: d.city,
        postal: d.postal, latitude: d.latitude, longitude: d.longitude, isp: d.org, asn: d.asn,
        timezone: d.timezone, utcOffset: d.utc_offset,
      };
    },
  },
];

// "Bhopāl" / "bhopal " / "New Delhi" vs "Delhi" -> comparable keys
const cityKey = (c) =>
  String(c || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^new\s+/, '').trim();

// Raw answers from every provider for one IP (cached per IP)
async function query(ip) {
  const hit = cache.get(ip);
  if (hit && hit.until > Date.now()) return hit.data;
  const active = providers.filter((p) => !p.enabled || p.enabled());
  const settled = await Promise.allSettled(active.map((p) => p.get(ip)));
  const results = settled
    .map((s, i) => (s.status === 'fulfilled' && s.value?.city ? { ...s.value, source: active[i].name, rank: i } : null))
    .filter(Boolean);
  if (results.length) {
    cache.set(ip, { data: results, until: Date.now() + TTL });
    if (cache.size > 5000) cache.delete(cache.keys().next().value);
  }
  return results;
}

/** Votes on the city across all answers; ties go to the higher-priority provider. */
function vote(results, primaryIp) {
  const votes = new Map();
  for (const r of results) {
    const k = cityKey(r.city);
    const v = votes.get(k) || { count: 0, best: r };
    v.count += 1;
    // Prefer the record for the request's own IP, then provider priority
    const better = (a, b) => (a.ip === primaryIp) - (b.ip === primaryIp) || b.rank - a.rank;
    if (better(r, v.best) > 0) v.best = r;
    votes.set(k, v);
  }
  const winner = [...votes.values()].sort((a, b) => b.count - a.count || a.best.rank - b.best.rank)[0];
  const agreeing = results.filter((r) => cityKey(r.city) === cityKey(winner.best.city));

  // Fill any blanks in the winner from providers that agreed on the same city
  const merged = { ...winner.best };
  for (const r of agreeing) for (const [k, val] of Object.entries(r)) if (merged[k] == null || merged[k] === '') merged[k] = val;
  delete merged.rank;

  return {
    ...merged,
    flag: merged.flag || flagFromCode(merged.countryCode),
    // e.g. 5/7 provider answers said "Bhopal"
    cityConfidence: `${winner.count}/${results.length}`,
  };
}

const IPV6 = /^[0-9a-f:]{3,45}$/i;

/**
 * @param ip      the request's IP (trusted)
 * @param ipv6    optional IPv6 the browser reported (api6.ipify.org). Same device, often geolocated
 *                more precisely than a mobile carrier's shared IPv4, so its answers join the vote.
 */
export async function geolocateIp(ip, ipv6) {
  if (isPrivate(ip)) {
    // Local dev: look up this machine's public IP. In production a private IP means the real client
    // IP was lost behind a proxy; looking up '' there would return the *server's* city, so refuse.
    if (process.env.NODE_ENV === 'production') throw new Error(`no public client IP (${ip || 'empty'})`);
    ip = '';
  }
  const extra = typeof ipv6 === 'string' && ipv6.includes(':') && IPV6.test(ipv6) && !isPrivate(ipv6) && ipv6 !== ip ? ipv6 : null;
  const [main, more] = await Promise.all([query(ip), extra ? query(extra).catch(() => []) : []]);
  const all = [...main, ...more];
  if (!all.length) throw new Error('all IP location providers failed');
  // The stored IP is always the request's own; only the city vote uses the extra answers
  const g = vote(all, main[0]?.ip);
  return { ...g, ip: main[0]?.ip || g.ip, ipv6: extra || undefined };
}
