var Slocket = require('../')
var rimraf = require('rimraf')
var node = process.execPath
var spawn = require('child_process').spawn
var fs = require('fs')
var t = require('tap')
t.jobs = 4

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
  clear(n)
  return lockPrefix + n
}
function clear (n) {
  try { rimraf.sync(lockPrefix + n) } catch (er) {}
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

t.test('3 serial locks', function (t) {
  clear('3-serial')
  var file = filename('3-serial')
  t.teardown(clear.bind(null, '3-serial'))
  function go (i) {
    if (i === 3)
      return t.end()
    Slocket(file, function (er, lock) {
      if (er)
        throw er
      t.pass('got lock ' + i)
      lock.release()
      go(i+1)
    })
  }
  go(0)
})

t.test('staggered', function (t) {
  clear('3-staggered')
  var file = filename('3-staggered')
  t.teardown(clear.bind(null, '3-staggered'))

  var set = []
  Slocket(file).then(function (lock) {
    set[0] = lock
    t.equal(lock.type(), 'server')
    Slocket(file, function (er, lock) {
      t.equal(lock.type(), 'connection')
      set[1] = lock

      Slocket(file, function (er, lock) {
        t.equal(lock.type(), 'connection')
        lock.release()
        t.end()
      })
      setTimeout(function () {
        lock.release()
      }, 100)
    }).on('connect', function () {
      lock.release()
    })
  })
})

t.test('server disconnect', function (t) {
  var file = filename('server-disconnect')
  var prog = require.resolve('./fixtures/server-disconnect.js')
  var child = spawn(node, [prog, file])
  child.stderr.pipe(process.stderr)
  child.stdout.on('data', function () {
    // now we know that the server has the lock
    var didKill = false
    setTimeout(function () {
      child.kill('SIGHUP')
    })

    var clients = [
      Slocket(file, onLock),
      Slocket(file, onLock),
      Slocket(file, onLock),
      Slocket(file, onLock),
      Slocket(file, onLock)
    ]
    Promise.all(clients).then(t.end)

    function onLock (er, lock) {
      var has = clients.filter(function (c) { return c.has })
      t.equal(has.length, 1, 'always exactly one lock')
      if (!didKill) {
        didKill = true
        child.kill('SIGINT')
        setTimeout(lock.release, 100)
      } else
        lock.release()
    }
  })
})

t.test('server process graceful exit', function (t) {
  var file = filename('graceful-exit')
  var prog = require.resolve('./fixtures/graceful-exit.js')
  var child = spawn(node, [prog, file])
  var childClosed = false
  child.on('close', function (code, signal) {
    childClosed = true
    t.equal(code, 0)
    t.equal(signal, null)
  })

  child.stderr.pipe(process.stderr)
  child.stdout.on('data', function () {
    // now we know that the server has the lock
    var didKill = false
    setTimeout(function () {
      child.kill('SIGHUP')
    })

    var clients = [
      Slocket(file, onLock),
      Slocket(file, onLock),
      Slocket(file, onLock),
      Slocket(file, onLock),
      Slocket(file, onLock)
    ]
    Promise.all(clients).then(function () {
      t.ok(childClosed, 'child process exited gracefully')
      t.end()
    })

    function onLock (er, lock) {
      var has = clients.filter(function (c) { return c.has })
      t.equal(has.length, 1, 'always exactly one lock')
      setTimeout(lock.release, 100)
    }
  })
})

t.test('server process graceful exit without release', function (t) {
  var file = filename('server-disconnect-graceful')
  var prog = require.resolve('./fixtures/exit-no-release.js')
  var child = spawn(node, [prog, file], {
    env: { NODE_DEBUG: 'slocket' }
  })
  var childClosed = false
  child.on('close', function (code, signal) {
    childClosed = true
    t.equal(code, null)
    t.equal(signal, 'SIGHUP')
  })

  var stderr = ''
  child.stderr.on('data', function (c) {
    stderr += c
  })
  child.stdout.on('data', function () {
    // now we know that the server has the lock
    var didKill = false
    setTimeout(function () {
      child.kill('SIGHUP')
    })

    var clients = [
      Slocket(file, onLock),
      Slocket(file, onLock),
      Slocket(file, onLock),
      Slocket(file, onLock),
      Slocket(file, onLock)
    ]
    Promise.all(clients).then(function () {
      t.ok(childClosed, 'child process exited gracefully')
      t.match(stderr, /onProcessExit\n/, 'hit the onProcessExit fn')
      t.end()
    })

    function onLock (er, lock) {
      var has = clients.filter(function (c) { return c.has })
      t.equal(has.length, 1, 'always exactly one lock')
      setTimeout(lock.release, 100)
    }
  })
})

t.test('try to lock on a non-socket, auto-lock once gone', {
  skip: process.platform === 'win32' ? 'skip on windows' : ''
}, function (t) {
  var file = filename('not-a-socket')
  var fs = require('fs')
  fs.writeFileSync(file, 'not a socket\n')
  var lock = Slocket(file, function (er, lock) {
    lock.release()
    t.end()
  })
  t.notOk(lock.has)
  t.notOk(fs.statSync(file).isSocket())
  rimraf(file, function () {})
})

t.test('try to lock on non-Slocket socket', function (t) {
  var file = filename('non-slocket')
  var maker = require.resolve('./fixtures/abandon-socket.js')
  spawn(node, [maker, file]).on('close', function () {
    t.ok(fs.statSync(file).isSocket(), 'socket is there')
    var deleted = false
    setTimeout(function () {
      fs.unlinkSync(file)
      t.notOk(lock.has, 'should not have lock yet')
      deleted = true
    }, 100)
    var lock = Slocket(file, function (er, lock) {
      if (er)
        throw er
      t.ok(deleted, 'deleted file before lock acquired')
      t.equal(lock.type(), 'server')
      t.end()
    })
  })
})

t.test('server disconnect, connection sync end', function (t) {
  var file = filename('server-disconnect-conn-sync-end')
  var prog = require.resolve('./fixtures/server-disconnect.js')
  var child = spawn(node, [prog, file])
  child.stderr.pipe(process.stderr)
  child.stdout.on('data', function () {
    // now we know that the server has the lock
    var didKill = false
    setTimeout(function () {
      child.kill('SIGINT')
    }, 100)

    Slocket(file, function onLock (er, lock) {
      setTimeout(function () {
        lock.release(true)
        t.throws(fs.statSync.bind(fs, file))
        t.end()
      }, 100)
    })
  })
})

t.test('server kill connection abruptly', function (t) {
  var file = filename('server-kill-abruptly')
  Slocket(file, function (er, serverLock) {
    if (er)
      throw er
    t.equal(serverLock.type(), 'server')

    var clients = [
      Slocket(file, onLock),
      Slocket(file, onLock),
      Slocket(file, onLock),
      Slocket(file, onLock),
      Slocket(file, onLock)
    ]
    Promise.all(clients).then(t.end)

    function onLock (er, lock) {
      var has = clients.filter(function (c) { return c.has })
      t.equal(has.length, 1, 'always exactly one lock')
      setTimeout(lock.release, 100)
    }

    setTimeout(function () {
      t.equal(serverLock.currentClient, null)
      t.ok(serverLock.has)
      t.equal(serverLock.connectionQueue.length, 5)
      serverLock.connectionQueue[0].destroy()
      serverLock.connectionQueue[2].destroy()
      serverLock.connectionQueue[4].destroy()
      setTimeout(function () {
        t.equal(serverLock.connectionQueue.length, 5)
        serverLock.release()
      }, 100)
    }, 100)
  })
})

t.test('verify behavior when pretending to be windows', function (t) {
  var file = filename('windows-pretend')
  var locks = [
    Slocket(file, onLock),
    Slocket(file, onLock),
    Slocket(file, onLock),
    Slocket(file, onLock),
    Slocket(file, onLock)
  ]

  locks.forEach(function (l) {
    l.windows = true
  })

  function onLock (er, lock) {
    if (er)
      throw er

    // all locks are servers on windows, clients are just for waiting
    t.equal(lock.type(), 'server', 'is a server')
    var has = locks.filter(function (c) { return c.has })
    t.equal(has.length, 1, 'always exactly one lock')
    setTimeout(lock.release, 100)
  }

  return Promise.all(locks)
})

t.test('server object emit error after being removed')
t.test('delete socket between EADDRINUSE and connect')
t.test('release before connection connects')
