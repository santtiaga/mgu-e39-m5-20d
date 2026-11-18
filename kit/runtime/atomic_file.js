'use strict';

const fs = require('fs');
const path = require('path');
let sequence = 0;

function writeAtomicFile(file, data, durable, log, mode) {
    const temp = file + '.tmp.' + process.pid + '_' + (++sequence);
    let fd = null;
    try {
        fd = fs.openSync(temp, 'wx', mode === undefined ? 0o600 : mode);
        fs.writeFileSync(fd, data);
        if (durable) fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = null;
        fs.renameSync(temp, file);
        if (durable) {
            let dirFd = null;
            try { dirFd = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(dirFd); }
            catch (ignored) { /* directory fsync is not supported by every filesystem */ }
            finally { if (dirFd !== null) try { fs.closeSync(dirFd); } catch (ignored2) {} }
        }
        return true;
    } catch (error) {
        if (fd !== null) try { fs.closeSync(fd); } catch (ignored3) {}
        try { fs.unlinkSync(temp); } catch (ignored4) {}
        if (log && log.warn) log.warn('atomic write ' + path.basename(file) + ': ' + (error && error.message || error));
        return false;
    }
}

/*
 * RHMI only accepts image resources from rhmiData/resources. PNG data is
 * staged in /dev/shm where available, then atomically promoted into that
 * ACL-approved directory. The final resource path is never a partial PNG.
 */
function writeImageResource(file, png, log) {
    let staged = null;
    try {
        const ram = '/dev/shm';
        if (fs.existsSync(ram) && fs.statSync(ram).isDirectory()) {
            staged = path.join(ram, 'mgu_img_' + process.pid + '_' + (++sequence) + '.png');
            try {
                fs.writeFileSync(staged, png);
                png = fs.readFileSync(staged);
            } catch (stageError) {
                try { fs.unlinkSync(staged); } catch (ignored2) {}
                staged = null; // RAM staging is an optimisation, never a reason to lose a frame
            }
        }
        if (!writeAtomicFile(file, png, false, log, 0o644)) throw new Error('could not atomically publish image resource');
    } finally {
        if (staged) try { fs.unlinkSync(staged); } catch (ignored) {}
    }
}

module.exports = { writeAtomicFile, writeImageResource };
