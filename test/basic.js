var Slocket = require('../')
var rimraf = require('rimraf')
var t = require('tap')
t.jobs = 1

if (typeof Promise === 'undefined')
  Promise = require('bluebird')

t.teardown(function () {
  names.forEach(function (n) {
    clear(n)
  })
})

var names = []
var lockPrefix = (process.platform === 'win32')
  ? ('\\\\.\\pipe\\' + __dirname + '\\') : (__dirname + '/')
function filename (n) {
  names.push(n)
  return lockPrefix + n
}
function clear (n) {
  rimraf.sync(lockPrefix + n)
}

t.test('3 parallel locks', function (t) {
  var locks = []
  clear('3-parallel')
  var file = filename('3-parallel')

  // also tests returning a promise
  for (var i = 0; i < 3; i++) {
    locks[i] = Slocket(file)
  }

  setInterval(function () {
    var h = has()
    if (h.filter(h => h).length > 1)
      throw new Error('double-lock: ' + JSON.stringify(h))
  }, 1000).unref()

  function has () {
    return locks.map(function (l, i) {
      return l.has
    })
  }

  t.same(has(), [ false, false, false ], 'no locks acquired sync')

  locks.forEach(function (l, i) {
    l.then(acquired(i))
  })

  var got = []
  function acquired (i) { return function (lock) {
    t.comment('acquired %d', i)
    t.equal(got.indexOf(i), -1, 'should not have gotten already')
    got.push(i)
    var expect = [false, false, true]
    t.same(has().sort(), expect, 'should have exactly 1 lock')
    t.isa(lock, Slocket)
    t.test('should not look like a promise or deferred', function (t) {
      t.equal(lock.then, undefined)
      t.equal(lock.catch, undefined)
      t.equal(lock.resolve, undefined)
      t.equal(lock.reject, undefined)
      t.end()
    })
    setTimeout(function () {
      lock.release()
    }, 100)
  }}

  Promise.all(locks).then(function (locks) {
    setTimeout(function () {
      t.same(has(), [false, false, false], 'no remaining locks')
      t.same(got.sort(), [ 0, 1, 2 ], 'got all 3 locks')
      clear('3-parallel')
      t.end()
    }, 100)
  })
})

// these would get up to or near 100% coverage
t.test('3 serial locks')
t.test('open 1, open 2, close 1, close 2, open 3, close 3')
t.test('open 1, connect 3, disconnect abruptly')
t.test('server object emit error after being removed')
t.test('try to lock on a non-socket, auto-lock once removed')
t.test('try to lock a socket that is not a slocket server')
t.test('delete socket between EADDRINUSE and connect')
t.test('server kill connection abruptly')
t.test('release before connection connects')
