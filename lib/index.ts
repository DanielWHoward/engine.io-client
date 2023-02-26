import { Socket } from "./socket.js";

export { Socket };
export { SocketOptions } from "./socket.js";
export const protocol = Socket.protocol;
export { Transport } from "./transport.js";
export { transports } from "./transports/index.js";
import { installTimerFunctions } from "./util.js";
export { installTimerFunctions };
const v4 = {
  Socket,
  protocol,
  installTimerFunctions,
}
import v3 from './v3/index.js'
const versions = [
  v4,
  v3,
];
function getVersion(v: number) {
  return versions.find(el => el.protocol === v);
}
export {
  v3,
  v4,
  versions,
  getVersion,
};
