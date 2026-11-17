'use strict';
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');

const LOG_LINES = 16;
const IFACE = 'de.bmw.infotainment.personalization.SessionManager';
const INSTANCE = 'de.bmw.infotainment.personalization.SessionManager';
const FIELD = 'currentUserAccountReference';

mgu.run({
  async start(ctx) {
    const logFile = path.join(ctx.dataDir, 'driver_profiles_probe.log');
    const write = (level, message, data) => {
      const suffix = data === undefined ? '' : ' ' + safe(data);
      const line = new Date().toISOString() + ' ' + level + ' ' + message + suffix;
      ctx.log[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'info'](line);
      try { fs.appendFileSync(logFile, line + '\n'); } catch (e) { ctx.log.warn('probe log write: ' + e.message); }
    };
    const safe = (value) => {
      try { return JSON.stringify(value, (k, v) => typeof v === 'function' ? '[Function]' : v); }
      catch (e) { return String(value); }
    };
    const refreshLog = async () => {
      let lines = [];
      try { lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean).slice(-LOG_LINES); } catch (e) {}
      const pad = new Array(Math.max(0, LOG_LINES - lines.length)).fill('');
      await Promise.all(pad.concat(lines).map((line, i) =>
        ctx.ui.text('LOG_LINE_' + String(i + 1).padStart(2, '0'), line)));
    };
    let session = null;
    let lastProfile = null;
    const inspectNative = () => {
      try {
        const api = require('personalization');
        const names = Object.getOwnPropertyNames(api || {});
        const details = {};
        names.forEach((name) => {
          try { details[name] = typeof api[name]; } catch (e) { details[name] = 'unreadable'; }
        });
        write('INFO', 'personalization native module loaded', { exports: names, types: details });
        ctx.ui.text('STATUS', 'personalization module loaded; see log');
      } catch (e) {
        write('ERROR', 'personalization native module unavailable', { message: e.message, stack: e.stack });
        ctx.ui.text('STATUS', 'personalization module unavailable; see log');
      }
    };
    const startSessionWatch = async () => {
      if (session) { try { await session.shutdown(); } catch (e) {} session = null; }
      write('INFO', 'starting SessionManager watch', { iface: IFACE, instance: INSTANCE, field: FIELD });
      session = await ctx.signals.watch(IFACE, INSTANCE, {
        [FIELD]: (value) => {
          lastProfile = value;
          write('INFO', 'active profile update', { value, type: typeof value });
          ctx.ui.text('ACTIVE_PROFILE', 'Active profile: ' + (typeof value === 'string' && value ? value : 'none / unavailable'));
        }
      }, ctx.log);
      write(session.available ? 'INFO' : 'WARN', 'SessionManager watch initialized', {
        available: session.available, error: session.error, proxy: !!session.proxy
      });
      if (session.error) ctx.ui.text('STATUS', 'SessionManager unavailable: ' + session.error);
      else if (!session.available) ctx.ui.text('STATUS', 'Waiting for SessionManager provider');
      else ctx.ui.text('STATUS', 'SessionManager available; read-only probe');
    };
    const refresh = async () => {
      write('INFO', 'manual diagnostics refresh');
      inspectNative();
      await startSessionWatch();
      if (lastProfile !== null) ctx.ui.text('ACTIVE_PROFILE', 'Active profile: ' + lastProfile);
      await refreshLog();
    };
    ctx.ui.onClick('REFRESH', refresh);
    ctx.ui.onClick('OPEN_LOGS', async () => { await refreshLog(); return ctx.ui.open('LOGS'); });
    ctx.ui.onClick('LOG_REFRESH', refreshLog);
    ctx.ui.onClick('LOG_BACK', () => ctx.ui.open('MAIN'));
    process.on('exit', () => { if (session) { try { session.shutdown(); } catch (e) {} } });
    write('INFO', 'probe started', { app: ctx.spec.id, version: ctx.spec.version });
    await refresh();
  }
});
