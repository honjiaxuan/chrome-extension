// 域名工具：归一化与匹配，SW 与设置页共用这一份
(function () {
  'use strict';

  function normalizeDomain(raw) {
    let value = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!value) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = 'https://' + value;
    let parsed;
    try {
      parsed = new URL(value);
    } catch (e) {
      return '';
    }
    let host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    if (host.startsWith('www.')) host = host.slice(4);
    if (!host || !host.includes('.') || !/^[a-z0-9.-]+$/.test(host)) return '';
    if (host.startsWith('.') || host.startsWith('-') || host.includes('..')) return '';
    return host;
  }

  function hostMatchesDomain(hostname, domain) {
    const host = String(hostname || '').toLowerCase().replace(/\.+$/, '');
    const base = normalizeDomain(domain);
    if (!host || !base) return false;
    return host === base || host.endsWith('.' + base);
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (e) {
      return '';
    }
  }

  function matchedDomainFor(url, domains) {
    const host = hostOf(url);
    if (!host) return '';
    return domains.find((domain) => hostMatchesDomain(host, domain)) || '';
  }

  globalThis.HJX_DOMAINS = { normalizeDomain, hostMatchesDomain, hostOf, matchedDomainFor };
})();
