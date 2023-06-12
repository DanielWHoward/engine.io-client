/**
 * Module dependencies.
 */

import { Transport } from "../transport";
import parseqs from "parseqs";
import parser from "../engine.io-parser";
import inherit from '../component-inherit';
import yeast from "yeast";
import debugModule from 'debug';
var debug = debugModule("engine.io-client:polling");

/**
 * Is XHR2 supported?
 */

//var XMLHttpRequest = require('xmlhttprequest-ssl');
import XMLHttpRequest from "../xmlhttprequest";
var hasXHR2 = (function () {
  var xhr = XMLHttpRequest({ xdomain: false });
  return null != xhr.responseType;
})();

/**
 * Polling interface.
 *
 * @param {Object} opts
 * @api private
 */

function Polling (opts) {
  var forceBase64 = (opts && opts.forceBase64);
  if (!hasXHR2 || forceBase64) {
    this.supportsBinary = false;
  }
  Transport.call(this, opts);
}

/**
 * Inherits from Transport.
 */

inherit(Polling, Transport);

/**
 * Transport name.
 */

Polling.prototype.name = 'polling';

/**
 * Opens the socket (triggers polling). We write a PING message to determine
 * when the transport is open.
 *
 * @api private
 */

Polling.prototype.doOpen = function () {
  this.poll();
};

/**
 * Pauses polling.
 *
 * @param {Function} callback upon buffers are flushed and transport is paused
 * @api private
 */

Polling.prototype.pause = function (onPause) {
  var self = this;

  this.readyState = 'pausing';

  function pause () {
    debug('paused');
    self.readyState = 'paused';
    onPause();
  }

  if (this.polling || !this.writable) {
    var total = 0;

    if (this.polling) {
      debug('we are currently polling - waiting to pause');
      total++;
      this.once('pollComplete', function () {
        debug('pre-pause polling complete');
        --total || pause();
      });
    }

    if (!this.writable) {
      debug('we are currently writing - waiting to pause');
      total++;
      this.once('drain', function () {
        debug('pre-pause writing complete');
        --total || pause();
      });
    }
  } else {
    pause();
  }
};

/**
 * Starts polling cycle.
 *
 * @api public
 */

Polling.prototype.poll = function () {
  debug('polling');
  this.polling = true;
  this.doPoll();
  this.emit('poll');
};

/**
 * Overloads onData to detect payloads.
 *
 * @api private
 */

Polling.prototype.onData = function (data) {
  var self = this;
  debug('polling got data %s', data);
  var callback = function (packet, index, total) {
    // if its the first message we consider the transport open
    if ('opening' === self.readyState) {
      self.onOpen();
    }

    // if its a close packet, we close the ongoing requests
    if ('close' === packet.type) {
      self.onClose();
      return false;
    }

    // otherwise bypass onData and handle the message
    self.onPacket(packet);
  };

  // decode payload
  self.decodePayload(data, this.socket.binaryType, callback);

  // if an event did not trigger closing
  if ('closed' !== this.readyState) {
    // if we got data we're not polling
    this.polling = false;
    this.emit('pollComplete');

    if ('open' === this.readyState) {
      this.poll();
    } else {
      debug('ignoring poll - transport state "%s"', this.readyState);
    }
  }
};

/**
 * For polling, send a close packet.
 *
 * @api private
 */

Polling.prototype.doClose = function () {
  var self = this;

  function close () {
    debug('writing close packet');
    self.write([{ type: 'close' }]);
  }

  if ('open' === this.readyState) {
    debug('transport open - closing');
    close();
  } else {
    // in case we're trying to close while
    // handshaking is in progress (GH-164)
    debug('transport not open - deferring close');
    this.once('open', close);
  }
};

/**
 * Removes out of band data and decodes the clean payload.
 *
 * @param {Array} data packets
 * @param {Object} typ type
 * @param {Function} callback parser callback
 * @api private
 */

Polling.prototype.decodePayload = function (data, binaryType, callback) {
  var self = this;
  var cleanData = '';
  var outOfBand = '';
  var matchPos = [];
  if (typeof data === 'string') {
    data = data.substring(data.startsWith('ok') ? 2 : 0);
    // find packets
    var pos = data.indexOf(':');
    while (pos !== -1) {
      if ((pos > 0) && (pos < (data.length - 1))
          && (data[pos-1] >= '0') && (data[pos-1] <= '9')
          && (data[pos+1] >= '0') && (data[pos+1] <= '9')) {
        matchPos.push(pos);
      }
      pos = data.indexOf(':', pos + 1);
    }
    // separate packets from out of band data
    var prev = 0;
    var start = 0;
    var end = 0;
    var del = 0;
    var len = 0;
    var heur = 0;
    for (var m=0; m < matchPos.length; ++m) {
      start = matchPos[m] - del - 1;
      end = start + 1;
      while ((start >= 0) && (data[start] >= '0') && (data[start] <= '9')) {
        len = parseInt(data.substring(start, end));
        // heuristic to ignore extra outOfBand digit
        heur = data.length;
        if ((m + 1) < matchPos.length) {
          heur = matchPos[m+1] - del - 1;
        }
        if ((end + len) >= heur) {
          break;
        }
        --start;
      }
      ++start;
      if ((start >= 2) && (data.substring(start - 2, start) === 'ok')) {
        data = data.substring(0, start - 2) + data.substring(start);
        del += 2;
        start -= 2;
      }
      end = matchPos[m] - del;
      len = parseInt(data.substring(start, end));
      cleanData += data.substring(start, end+len+1);
      outOfBand += data.substring(prev, start);
      prev = end+len+1;
    }
    if (prev < data.length) {
      outOfBand += data.substring(prev);
    }
    // decode packets
    if (cleanData) {
      parser.decodePayload(cleanData, binaryType, callback);
    }
    if (outOfBand) {
      self.outOfBand(outOfBand);
    }
  } else if (data) {
    parser.decodePayload(data, binaryType, callback);
  }
};

/**
 * Writes a packets payload.
 *
 * @param {Array} data packets
 * @param {Function} drain callback
 * @api private
 */

Polling.prototype.write = function (packets) {
  var self = this;
  this.writable = false;
  var callback = function (packet, index, total) {
    // handle the message
    self.onPacket(packet);
  };
  var callbackfn = function (data) {
    self.decodePayload(data, self.socket.binaryType, callback);
    self.writable = true;
    self.emit('drain');
  };

  parser.encodePayload(packets, this.supportsBinary, function (data) {
    self.doWrite(data, callbackfn);
  });
};

/**
 * Generates uri for connection.
 *
 * @api private
 */

Polling.prototype.uri = function () {
  var query = this.query || {};
  var schema = this.secure ? 'https' : 'http';
  var port = '';
  var path = (typeof this.path === 'function') ? this.path() : this.path;

  // cache busting is forced
  if (false !== this.timestampRequests) {
    query[this.timestampParam] = yeast();
  }

  if (!this.supportsBinary && !query.sid) {
    query.b64 = 1;
  }

  query = parseqs.encode(query);

  // avoid port if default for schema
  if (this.port && (('https' === schema && Number(this.port) !== 443) ||
     ('http' === schema && Number(this.port) !== 80))) {
    port = ':' + this.port;
  }

  // prepend ? to query
  if (query.length) {
    query = '?' + query;
  }

  var ipv6 = this.hostname.indexOf(':') !== -1;
  return schema + '://' + (ipv6 ? '[' + this.hostname + ']' : this.hostname) + port + path + query;
};

export {
  Polling as default,
};