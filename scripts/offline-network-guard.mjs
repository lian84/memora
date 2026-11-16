// Manual smoke guard: deny JS fetch and new TCP sockets before the runtime loads.
// This is not an OS network namespace or a sandbox against native code.
import net from 'node:net';
globalThis.fetch = async () => { throw new Error('Offline guard: fetch denied'); };
net.Socket.prototype.connect = function () { throw new Error('Offline guard: TCP connection denied'); };
