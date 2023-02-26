
import { Socket } from './socket';

/**
 * Exports parser
 *
 * @api public
 *
 */
import parser from './engine.io-parser';

export default {
  protocol: parser.protocol,
  Socket,
  parser,
};