
/**
 * Gets the keys for an object.
 *
 * @return {Array} keys
 * @api private
 */

export default Object.keys || function keys (obj){
  var arr = [];
  var has = Object.prototype.hasOwnProperty;

  for (var i in obj) {
    if (has.call(obj, i)) {
      arr.push(i);
    }
  }
  return arr;
};
