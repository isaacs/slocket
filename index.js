module.exports = Slocket

var net = require('net')
var fs = require('fs')
var path = require('path')
var onExit = require('signal-exit')
var locks = Object.create(null)
var Deferred = require('trivial-deferred')
if (typeof Promise === undefined)
  Promise = require('bluebird')

function Slocket (name, cb) {
  if (!(this instanceof Slocket))
    return new Slocket(name, cb)

  this.deferred = new Deferred
  this.name = path.resolve(name)
  if (cb)
    this.cb = cb
  this.server = null
  this.connection = null
  this.watcher = null
  this.has = false
  this.acquire()
  this.connectionQueue = []

  this.then = this.deferred.promise.then.bind(this.deferred.promise)
  this.catch = this.deferred.promise.catch.bind(this.deferred.promise)
}

Slocket.prototype.cb = function () {}

Slocket.prototype.acquire = function () {
  this.unwatch()
  this.disconnect()
  this.server = net.createServer(this.onServerConnection.bind(this))
  this.server.on('error', this.onServerError.bind(this))
  this.server.listen(this.name, this.onServerListen.bind(this))
  this.server.on('close', this.onServerClose.bind(this))
}

Slocket.prototype.onAcquire = function () {
  this.unwatch()
  this.has = true
  this.cb(null, this)
  this.deferred.resolve(this)
}

Slocket.prototype.onServerListen = function () {
  onExit(this.onProcessExit.bind(this))
  this.onAcquire()
}

Slocket.prototype.onProcessExit = function () {
  if (this.has === true)
    this.release(true)
}

Slocket.prototype.onServerConnection = function (c) {
  c.on('close', this.onServerConnectionClose.bind(this, c))
  if (this.has)
    this.connectionQueue.push(c)
  else
    this.delegate(c)
}

Slocket.prototype.onServerConnectionClose = function (c) {
  if (this.has === c)
    this.release()

  var i = this.connectionQueue.indexOf(c)
  if (i !== -1)
    this.connectionQueue.splice(i, 1)
}

Slocket.prototype.delegate = function (c) {
  this.has = c
  c.write('OK')
}

Slocket.prototype.release = function (sync) {
  if (this.server)
    this.serverRelease(sync)
  else if (this.connection)
    this.connectionRelease(sync)
}

Slocket.prototype.serverRelease = function (sync) {
  this.server.unref()
  if (this.connectionQueue.length)
    this.delegate(this.connectionQueue.shift())
  else
    this.server.close()
}

Slocket.prototype.onServerClose = function () {
  this.server = null
}

Slocket.prototype.onServerError = function (er) {
  // XXX just in the off chance this happens later, kill any connections
  // and destroy the server
  this.server = null
  switch (er.code) {
    case 'ENOTSOCK':
      return this.watch()
    case 'EADDRINUSE':
    case 'EEXIST':
      return this.connect()
    default:
      er.slocket = 'server'
      this.onError(er)
  }
}

Slocket.prototype.onError = function (er) {
  this.cb(er, this)
  this.deferred.reject(er)
}

Slocket.prototype.connect = function () {
  this.connection = net.createConnection(this.name)
  this.connection.slocketBuffer = ''
  this.connection.setEncoding('utf8')
  this.connection.slocketConnected = false
  this.connection.on('connect', this.onConnect.bind(this))
  this.connection.on('error', this.onConnectionError.bind(this))
  this.connection.on('data', this.onConnectionData.bind(this))
}

Slocket.prototype.onConnectionData = function (chunk) {
  this.connection.slocketBuffer += chunk
  if (this.connection.slocketBuffer === 'OK')
    this.onAcquire()
  if (this.connection.slocketBuffer.length > 2) {
    console.error('destroy for long buffer')
    this.connection.destroy()
  }
}

Slocket.prototype.onConnectionError = function (er) {
  if (this.has)
    return this.onError(er)
  this.connection = null
  switch (er.code) {
    case 'ENOENT':
      // socket was there, but now is gone!
      return this.acquire()
    case 'ECONNREFUSED':
      // socket there, but not listening
      // watch for changes, in case it's that it's not a socket
      // if that fails, eg for "unknown system error", then just retry
      try {
        return this.watch()
      } catch (er) {
        return this.acquire()
      }
    default:
      er.slocket = 'connection'
      this.onError(er)
  }
}

Slocket.prototype.onConnect = function () {
  this.connection.slocketConnected = true
  this.connection.on('close', this.onConnectionClose.bind(this))
}

Slocket.prototype.onConnectionClose = function () {
  this.connection.slocketConnected = false
  if (!this.has)
    this.acquire()
}

Slocket.prototype.connectionRelease = function (sync) {
  if (this.connection.slocketConnected)
    this.connection.destroy()
  else if (sync)
    rimraf.sync(this.name)
  else
    rimraf(this.name, function () {})
}

Slocket.prototype.disconnect = function () {
  if (this.connection)
    this.connection.destroy()
  this.connection = null
}

Slocket.prototype.watch = function () {
  this.watcher = fs.watch(this.name, { persistent: false })
  this.watcher.on('change', this.acquire.bind(this))
  this.watch.on('error', this.acquire.bind(this))
}

Slocket.prototype.unwatch = function () {
  if (this.watcher)
    this.watcher.close()
  this.watcher = null
}
