var slocket = require('../')
var filename = __dirname + '/many-lock-unlock.lock'
var N = 1000
var lockfile = require('lockfile')
var rimraf = require('rimraf')

function parallel (cb) {
  rimraf.sync(filename)
  var start = Date.now()
  var did = 0
  for (var i = 0; i < N; i++) {
    slocket(filename, function (er) {
      if (er)
        throw er
      this.release()
      if (++did === N) {
        var dur = Date.now() - start
        console.log('parallel %d/%dms => %d q/s, %d ms/q', N, dur,
                    Math.round(N/dur * 1000),
                    Math.round(dur/N*1000)/1000)
        if (cb) cb()
      }
    })
  }
}

function serial (cb, i, start) {
  if (!i && !start) {
    rimraf.sync(filename)
    i = i || 0
    start = start || Date.now()
  }
  if (i === N) {
    var dur = Date.now() - start
    console.log('serial %d/%dms => %d q/s, %d ms/q', N, dur,
                Math.round(N/dur * 1000),
                Math.round(dur/N * 1000)/1000)
    if (cb) cb()
    return
  }
  slocket(filename, function (er) {
    if (er)
      throw er
    this.release()
    serial(cb, i + 1, start)
  })
}

function lfp (cb) {
  rimraf.sync(filename)
  var start = Date.now()
  var did = 0
  for (var i = 0; i < N; i++) {
    lockfile.lock(filename, { retries: Infinity }, function (er) {
      if (er)
        throw er
      lockfile.unlock(filename, function () {
        if (++did === N) {
          var dur = Date.now() - start
          console.log('lf parallel %d/%dms => %d q/s, %d ms/q', N, dur,
                      Math.round(N/dur * 1000),
                      Math.round(dur/N*1000)/1000)
          if (cb) cb()
        }
      })
    })
  }
}

function lfs (cb, i, start) {
  if (!i && !start) {
    rimraf.sync(filename)
    i = i || 0
    start = start || Date.now()
  }
  if (i === N) {
    var dur = Date.now() - start
    console.log('lfs %d/%dms => %d q/s, %d ms/q', N, dur,
                Math.round(N/dur * 1000),
                Math.round(dur/N * 1000)/1000)
    if (cb) cb()
    return
  }
  lockfile.lock(filename, function (er) {
    if (er)
      throw er
    lockfile.unlock(filename, function () {
      lfs(cb, i + 1, start)
    })
  })
}

parallel(() => serial(() => lfp(lfs)))
