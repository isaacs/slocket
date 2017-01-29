var slocket = require('../')
var MS = +process.argv[2] || 50
var N = +process.argv[3] || 5
var PARALLEL = process.argv[4] === 'parallel'
var IMMEDIATE = MS === 0
var res = { pid: process.pid, start: Date.now() }
var onExit = require('signal-exit')
var gotAll = false
var got = 0

runTests()

// Only one of these can run in this filesystem space,
// even if there are many processes running at once
function runTests () {
  if (PARALLEL)
    parallelTests()
  else
    serialTests()
}

function parallelTests () {
  for (var i = 0; i < N; i++)
    runTest(i)
}

function serialTests (i) {
  i = i || 0
  if (i < N)
    runTest(i, serialTests.bind(null, i + 1))
}

function runTest (i, cb) {
  var jitter = 0 // Math.floor((Math.random() - .5)*(MS * 0.1))
  res[i] = {
    start : Date.now(),
    jitter: jitter
  }
  slocket(__dirname + '/slocket-testing-'+i, function (er, lock) {
    if (er) throw er
    res[i].acquired = Date.now()
    res[i].has = lock.has
    res[i].how = lock.server ? 'server'
               : lock.connection ? 'connection'
               : lock
    if (IMMEDIATE)
      done()
    else
      setTimeout(done, MS + jitter)

    function done () {
      if (++got === N)
        gotAll = true
      res[i].release = Date.now()
      res[i].holdDuration = res[i].release - res[i].acquired
      res[i].totalDur = res[i].release - res[i].start
      lock.release()
      if (cb) cb()
    }
  })
}

onExit(function (code, signal) {
  res.code = code
  res.signal = signal
  res.gotAll = gotAll
  res.got = got
  res.end = Date.now()
  res.dur = res.end - res.start
  console.log('%j', res)
})
